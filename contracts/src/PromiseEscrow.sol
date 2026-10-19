// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title PromiseEscrow
/// @notice Holds USDC staked on a promise until the agent judges it.
/// Kept or expired: everyone gets their own money back. Broken: it all goes to the beneficiary.
/// The agent only picks the verdict; it can never choose where funds go.
contract PromiseEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Open,
        Kept,
        Broken,
        Expired
    }

    struct PromiseData {
        address maker;
        uint64 deadline;
        Status status;
        address beneficiary;
        uint128 makerStake;
        uint128 backedTotal;
    }

    uint256 public constant MAX_BACKERS = 20;

    IERC20 public immutable usdc;
    address public immutable agent;
    uint64 public immutable gracePeriod;

    mapping(bytes32 => PromiseData) internal _promises;
    mapping(bytes32 => mapping(address => uint128)) public backing;
    mapping(bytes32 => address[]) internal _backers;
    mapping(bytes32 => bool) public paymentCredited;

    /// @notice Sum of everything still owed on open promises.
    uint256 public totalLiabilities;

    event PromiseCreated(
        bytes32 indexed id, address indexed maker, address indexed beneficiary, uint256 amount, uint64 deadline
    );
    event Backed(bytes32 indexed id, address indexed backer, uint256 amount, bytes32 x402TxHash);
    event Refunded(bytes32 indexed id, address indexed to, uint256 amount);
    event Forfeited(bytes32 indexed id, address indexed beneficiary, uint256 total);
    event Settled(bytes32 indexed id, bool kept, uint256 total);
    event Expired(bytes32 indexed id, uint256 refunded);

    error NotAgent();
    error ZeroAddress();
    error ZeroAmount();
    error BadBeneficiary();
    error DeadlinePassed();
    error PromiseExists();
    error NotOpen();
    error GraceNotOver();
    error TooManyBackers();
    error AlreadyCredited();
    error NotEnoughUnattributed();

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    constructor(IERC20 usdc_, address agent_, uint64 gracePeriod_) {
        if (address(usdc_) == address(0) || agent_ == address(0)) revert ZeroAddress();
        usdc = usdc_;
        agent = agent_;
        gracePeriod = gracePeriod_;
    }

    function createPromise(bytes32 id, address beneficiary, uint256 amount, uint64 deadline) external nonReentrant {
        _create(id, beneficiary, amount, deadline);
    }

    /// @dev If someone front-runs the permit, it fails here but the allowance is already set,
    /// so we carry on and let transferFrom decide.
    function createPromiseWithPermit(
        bytes32 id,
        address beneficiary,
        uint256 amount,
        uint64 deadline,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        try IERC20Permit(address(usdc)).permit(msg.sender, address(this), amount, permitDeadline, v, r, s) {} catch {}
        _create(id, beneficiary, amount, deadline);
    }

    /// @notice Attribute USDC that already arrived (via x402) to a backer.
    function creditBacking(bytes32 id, address backer, uint256 amount, bytes32 x402TxHash)
        external
        onlyAgent
        nonReentrant
    {
        PromiseData storage p = _promises[id];
        if (p.status != Status.Open) revert NotOpen();
        if (block.timestamp >= p.deadline) revert DeadlinePassed();
        if (backer == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (paymentCredited[x402TxHash]) revert AlreadyCredited();
        if (amount > usdc.balanceOf(address(this)) - totalLiabilities) revert NotEnoughUnattributed();

        if (backing[id][backer] == 0) {
            if (_backers[id].length >= MAX_BACKERS) revert TooManyBackers();
            _backers[id].push(backer);
        }

        uint128 amt = SafeCast.toUint128(amount);
        paymentCredited[x402TxHash] = true;
        backing[id][backer] += amt;
        p.backedTotal += amt;
        totalLiabilities += amount;

        emit Backed(id, backer, amount, x402TxHash);
    }

    function settle(bytes32 id, bool kept) external onlyAgent nonReentrant {
        PromiseData storage p = _promises[id];
        if (p.status != Status.Open) revert NotOpen();

        uint256 total = uint256(p.makerStake) + p.backedTotal;
        totalLiabilities -= total;

        if (kept) {
            p.status = Status.Kept;
            emit Settled(id, true, total);
            _refundAll(id, p);
        } else {
            p.status = Status.Broken;
            emit Settled(id, false, total);
            emit Forfeited(id, p.beneficiary, total);
            usdc.safeTransfer(p.beneficiary, total);
        }
    }

    /// @notice Anyone can call this once the agent has missed the grace window.
    function expire(bytes32 id) external nonReentrant {
        PromiseData storage p = _promises[id];
        if (p.status != Status.Open) revert NotOpen();
        if (block.timestamp <= uint256(p.deadline) + gracePeriod) revert GraceNotOver();

        uint256 total = uint256(p.makerStake) + p.backedTotal;
        totalLiabilities -= total;
        p.status = Status.Expired;

        emit Expired(id, total);
        _refundAll(id, p);
    }

    function getPromise(bytes32 id) external view returns (PromiseData memory) {
        return _promises[id];
    }

    function backersOf(bytes32 id) external view returns (address[] memory) {
        return _backers[id];
    }

    function _create(bytes32 id, address beneficiary, uint256 amount, uint64 deadline) internal {
        if (_promises[id].status != Status.None) revert PromiseExists();
        if (beneficiary == address(0)) revert ZeroAddress();
        if (beneficiary == msg.sender) revert BadBeneficiary();
        if (amount == 0) revert ZeroAmount();
        if (deadline <= block.timestamp) revert DeadlinePassed();

        _promises[id] = PromiseData({
            maker: msg.sender,
            deadline: deadline,
            status: Status.Open,
            beneficiary: beneficiary,
            makerStake: SafeCast.toUint128(amount),
            backedTotal: 0
        });
        totalLiabilities += amount;

        emit PromiseCreated(id, msg.sender, beneficiary, amount, deadline);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    function _refundAll(bytes32 id, PromiseData storage p) internal {
        emit Refunded(id, p.maker, p.makerStake);
        usdc.safeTransfer(p.maker, p.makerStake);

        address[] storage list = _backers[id];
        for (uint256 i; i < list.length; ++i) {
            address b = list[i];
            uint256 amt = backing[id][b];
            emit Refunded(id, b, amt);
            usdc.safeTransfer(b, amt);
        }
    }
}
