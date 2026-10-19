// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PromiseEscrow} from "../src/PromiseEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {ReentrantToken} from "./mocks/ReentrantToken.sol";

contract PromiseEscrowTest is Test {
    event PromiseCreated(
        bytes32 indexed id, address indexed maker, address indexed beneficiary, uint256 amount, uint64 deadline
    );
    event Backed(bytes32 indexed id, address indexed backer, uint256 amount, bytes32 x402TxHash);
    event Refunded(bytes32 indexed id, address indexed to, uint256 amount);
    event Forfeited(bytes32 indexed id, address indexed beneficiary, uint256 total);
    event Settled(bytes32 indexed id, bool kept, uint256 total);
    event Expired(bytes32 indexed id, uint256 refunded);

    uint64 constant GRACE = 72 hours;
    uint256 constant STAKE = 5e6;

    MockUSDC usdc;
    PromiseEscrow escrow;

    address agent = makeAddr("agent");
    address beneficiary = makeAddr("beneficiary");
    address payer = makeAddr("x402-payer");
    uint256 makerKey = 0xA11CE;
    address maker;

    bytes32 id = keccak256("promise-1");
    uint64 deadline;

    function setUp() public {
        maker = vm.addr(makerKey);
        usdc = new MockUSDC();
        escrow = new PromiseEscrow(IERC20(address(usdc)), agent, GRACE);
        deadline = uint64(block.timestamp + 7 days);
        usdc.mint(maker, 100e6);
    }

    // helpers

    function _create() internal {
        vm.startPrank(maker);
        usdc.approve(address(escrow), STAKE);
        escrow.createPromise(id, beneficiary, STAKE, deadline);
        vm.stopPrank();
    }

    /// Simulates an x402 payment landing in the escrow, then the agent crediting it.
    function _back(bytes32 pid, address backer, uint256 amount) internal {
        usdc.mint(address(escrow), amount);
        vm.prank(agent);
        escrow.creditBacking(pid, backer, amount, keccak256(abi.encode(pid, backer, amount, block.number)));
    }

    function _signPermit(uint256 key, uint256 value, uint256 permitDeadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        address owner = vm.addr(key);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                address(escrow),
                value,
                usdc.nonces(owner),
                permitDeadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(key, digest);
    }

    // constructor

    function test_Constructor() public view {
        assertEq(address(escrow.usdc()), address(usdc));
        assertEq(escrow.agent(), agent);
        assertEq(escrow.gracePeriod(), GRACE);
    }

    function test_Constructor_RevertsOnZero() public {
        vm.expectRevert(PromiseEscrow.ZeroAddress.selector);
        new PromiseEscrow(IERC20(address(0)), agent, GRACE);
        vm.expectRevert(PromiseEscrow.ZeroAddress.selector);
        new PromiseEscrow(IERC20(address(usdc)), address(0), GRACE);
    }

    // create

    function test_Create_LocksStake() public {
        vm.startPrank(maker);
        usdc.approve(address(escrow), STAKE);
        vm.expectEmit(address(escrow));
        emit PromiseCreated(id, maker, beneficiary, STAKE, deadline);
        escrow.createPromise(id, beneficiary, STAKE, deadline);
        vm.stopPrank();

        PromiseEscrow.PromiseData memory p = escrow.getPromise(id);
        assertEq(p.maker, maker);
        assertEq(p.beneficiary, beneficiary);
        assertEq(p.makerStake, STAKE);
        assertEq(p.backedTotal, 0);
        assertEq(p.deadline, deadline);
        assertEq(uint8(p.status), uint8(PromiseEscrow.Status.Open));
        assertEq(usdc.balanceOf(address(escrow)), STAKE);
        assertEq(usdc.balanceOf(maker), 95e6);
        assertEq(escrow.totalLiabilities(), STAKE);
    }

    function test_Create_RevertsOnDuplicateId() public {
        _create();
        vm.startPrank(maker);
        usdc.approve(address(escrow), STAKE);
        vm.expectRevert(PromiseEscrow.PromiseExists.selector);
        escrow.createPromise(id, beneficiary, STAKE, deadline);
        vm.stopPrank();
    }

    function test_Create_RevertsOnBadInput() public {
        vm.startPrank(maker);
        usdc.approve(address(escrow), STAKE);

        vm.expectRevert(PromiseEscrow.ZeroAddress.selector);
        escrow.createPromise(id, address(0), STAKE, deadline);

        vm.expectRevert(PromiseEscrow.BadBeneficiary.selector);
        escrow.createPromise(id, maker, STAKE, deadline);

        vm.expectRevert(PromiseEscrow.ZeroAmount.selector);
        escrow.createPromise(id, beneficiary, 0, deadline);

        vm.expectRevert(PromiseEscrow.DeadlinePassed.selector);
        escrow.createPromise(id, beneficiary, STAKE, uint64(block.timestamp));
        vm.stopPrank();
    }

    function test_Create_RevertsWithoutAllowance() public {
        vm.prank(maker);
        vm.expectRevert();
        escrow.createPromise(id, beneficiary, STAKE, deadline);
    }

    // permit

    function test_CreateWithPermit() public {
        uint256 pd = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(makerKey, STAKE, pd);

        vm.prank(maker);
        escrow.createPromiseWithPermit(id, beneficiary, STAKE, deadline, pd, v, r, s);

        assertEq(usdc.balanceOf(address(escrow)), STAKE);
        assertEq(usdc.nonces(maker), 1);
        assertEq(escrow.getPromise(id).maker, maker);
    }

    function test_CreateWithPermit_SurvivesFrontRun() public {
        uint256 pd = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(makerKey, STAKE, pd);

        // someone copies the permit from the mempool and submits it first
        vm.prank(makeAddr("griefer"));
        usdc.permit(maker, address(escrow), STAKE, pd, v, r, s);
        assertEq(usdc.allowance(maker, address(escrow)), STAKE);

        // the maker's own tx still goes through
        vm.prank(maker);
        escrow.createPromiseWithPermit(id, beneficiary, STAKE, deadline, pd, v, r, s);
        assertEq(usdc.balanceOf(address(escrow)), STAKE);
        assertEq(usdc.allowance(maker, address(escrow)), 0);
    }

    function test_CreateWithPermit_BadSignatureNoAllowanceReverts() public {
        uint256 pd = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(0xB0B, STAKE, pd);

        vm.prank(maker);
        vm.expectRevert();
        escrow.createPromiseWithPermit(id, beneficiary, STAKE, deadline, pd, v, r, s);
    }

    // creditBacking

    function test_CreditBacking() public {
        _create();
        address rahul = makeAddr("rahul");
        usdc.mint(address(escrow), 1e6);
        bytes32 tx402 = keccak256("x402-tx");

        vm.expectEmit(address(escrow));
        emit Backed(id, rahul, 1e6, tx402);
        vm.prank(agent);
        escrow.creditBacking(id, rahul, 1e6, tx402);

        assertEq(escrow.backing(id, rahul), 1e6);
        assertEq(escrow.getPromise(id).backedTotal, 1e6);
        assertEq(escrow.backersOf(id).length, 1);
        assertTrue(escrow.paymentCredited(tx402));
        assertEq(escrow.totalLiabilities(), STAKE + 1e6);
    }

    function test_CreditBacking_SameBackerTwice() public {
        _create();
        address rahul = makeAddr("rahul");
        _back(id, rahul, 1e6);
        vm.roll(block.number + 1);
        _back(id, rahul, 2e6);
        assertEq(escrow.backing(id, rahul), 3e6);
        assertEq(escrow.backersOf(id).length, 1);
    }

    function test_CreditBacking_LimitedToUnattributed() public {
        _create();
        // nothing extra has arrived, so the maker's stake can't be re-credited as backing
        vm.prank(agent);
        vm.expectRevert(PromiseEscrow.NotEnoughUnattributed.selector);
        escrow.creditBacking(id, makeAddr("rahul"), 1, keccak256("a"));

        usdc.mint(address(escrow), 1e6);
        vm.prank(agent);
        vm.expectRevert(PromiseEscrow.NotEnoughUnattributed.selector);
        escrow.creditBacking(id, makeAddr("rahul"), 1e6 + 1, keccak256("b"));

        vm.prank(agent);
        escrow.creditBacking(id, makeAddr("rahul"), 1e6, keccak256("c"));

        // the same 1 USDC can't be credited twice
        vm.prank(agent);
        vm.expectRevert(PromiseEscrow.NotEnoughUnattributed.selector);
        escrow.creditBacking(id, makeAddr("priya"), 1, keccak256("d"));
    }

    function test_CreditBacking_Reverts() public {
        _create();
        usdc.mint(address(escrow), 10e6);

        vm.expectRevert(PromiseEscrow.NotAgent.selector);
        escrow.creditBacking(id, payer, 1e6, keccak256("a"));

        vm.startPrank(agent);
        vm.expectRevert(PromiseEscrow.NotOpen.selector);
        escrow.creditBacking(keccak256("nope"), payer, 1e6, keccak256("a"));

        vm.expectRevert(PromiseEscrow.ZeroAddress.selector);
        escrow.creditBacking(id, address(0), 1e6, keccak256("a"));

        vm.expectRevert(PromiseEscrow.ZeroAmount.selector);
        escrow.creditBacking(id, payer, 0, keccak256("a"));

        escrow.creditBacking(id, payer, 1e6, keccak256("a"));
        vm.expectRevert(PromiseEscrow.AlreadyCredited.selector);
        escrow.creditBacking(id, payer, 1e6, keccak256("a"));

        vm.warp(deadline);
        vm.expectRevert(PromiseEscrow.DeadlinePassed.selector);
        escrow.creditBacking(id, payer, 1e6, keccak256("b"));
        vm.stopPrank();
    }

    function test_CreditBacking_MaxBackers() public {
        _create();
        for (uint256 i; i < escrow.MAX_BACKERS(); ++i) {
            _back(id, address(uint160(0x1000 + i)), 1e5);
        }
        usdc.mint(address(escrow), 1e5);
        vm.prank(agent);
        vm.expectRevert(PromiseEscrow.TooManyBackers.selector);
        escrow.creditBacking(id, address(0x9999), 1e5, keccak256("one-too-many"));
    }

    // settle: kept

    function test_Settle_Kept_RefundsEveryoneTheirOwn() public {
        _create();
        address[3] memory backers = [makeAddr("rahul"), makeAddr("priya"), makeAddr("sam")];
        uint256[3] memory amounts = [uint256(1e6), 2e6, 500_000];
        for (uint256 i; i < 3; ++i) {
            _back(id, backers[i], amounts[i]);
        }
        uint256 total = STAKE + 3.5e6;
        uint256 makerBefore = usdc.balanceOf(maker);

        vm.expectEmit(address(escrow));
        emit Settled(id, true, total);
        vm.expectEmit(address(escrow));
        emit Refunded(id, maker, STAKE);
        for (uint256 i; i < 3; ++i) {
            vm.expectEmit(address(escrow));
            emit Refunded(id, backers[i], amounts[i]);
        }
        vm.recordLogs();
        vm.prank(agent);
        escrow.settle(id, true);

        assertEq(_countLogs(Refunded.selector), 4, "one Refunded per party");
        assertEq(_countLogs(Forfeited.selector), 0);

        assertEq(usdc.balanceOf(maker), makerBefore + STAKE);
        for (uint256 i; i < 3; ++i) {
            assertEq(usdc.balanceOf(backers[i]), amounts[i]);
        }
        assertEq(usdc.balanceOf(beneficiary), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalLiabilities(), 0);
        assertEq(uint8(escrow.getPromise(id).status), uint8(PromiseEscrow.Status.Kept));
    }

    // settle: broken

    function test_Settle_Broken_AllToBeneficiary() public {
        _create();
        _back(id, makeAddr("rahul"), 1e6);
        _back(id, makeAddr("priya"), 2e6);
        uint256 total = STAKE + 3e6;
        uint256 makerBefore = usdc.balanceOf(maker);

        vm.expectEmit(address(escrow));
        emit Settled(id, false, total);
        vm.expectEmit(address(escrow));
        emit Forfeited(id, beneficiary, total);
        vm.recordLogs();
        vm.prank(agent);
        escrow.settle(id, false);

        assertEq(_countLogs(Forfeited.selector), 1);
        assertEq(_countLogs(Refunded.selector), 0);
        assertEq(usdc.balanceOf(beneficiary), total);
        assertEq(usdc.balanceOf(maker), makerBefore);
        assertEq(usdc.balanceOf(makeAddr("rahul")), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.getPromise(id).status), uint8(PromiseEscrow.Status.Broken));
    }

    function test_Settle_OnlyAgent() public {
        _create();
        vm.prank(maker);
        vm.expectRevert(PromiseEscrow.NotAgent.selector);
        escrow.settle(id, true);
    }

    function test_Settle_OnlyOnce() public {
        _create();
        vm.startPrank(agent);
        escrow.settle(id, true);
        vm.expectRevert(PromiseEscrow.NotOpen.selector);
        escrow.settle(id, false);
        vm.stopPrank();
    }

    function test_Settle_WorksAfterDeadline() public {
        _create();
        vm.warp(deadline + 1 days);
        vm.prank(agent);
        escrow.settle(id, false);
        assertEq(usdc.balanceOf(beneficiary), STAKE);
    }

    // expire

    function test_Expire_RevertsBeforeGraceEnds() public {
        _create();
        vm.expectRevert(PromiseEscrow.GraceNotOver.selector);
        escrow.expire(id);

        vm.warp(deadline + GRACE);
        vm.expectRevert(PromiseEscrow.GraceNotOver.selector);
        escrow.expire(id);
    }

    function test_Expire_RefundsEveryoneAfterGrace() public {
        _create();
        address rahul = makeAddr("rahul");
        _back(id, rahul, 1e6);
        uint256 makerBefore = usdc.balanceOf(maker);

        vm.warp(deadline + GRACE + 1);
        vm.expectEmit(address(escrow));
        emit Expired(id, STAKE + 1e6);
        vm.recordLogs();
        vm.prank(makeAddr("anyone"));
        escrow.expire(id);

        assertEq(_countLogs(Refunded.selector), 2);
        assertEq(usdc.balanceOf(maker), makerBefore + STAKE);
        assertEq(usdc.balanceOf(rahul), 1e6);
        assertEq(usdc.balanceOf(beneficiary), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.getPromise(id).status), uint8(PromiseEscrow.Status.Expired));

        vm.expectRevert(PromiseEscrow.NotOpen.selector);
        escrow.expire(id);
        vm.prank(agent);
        vm.expectRevert(PromiseEscrow.NotOpen.selector);
        escrow.settle(id, false);
    }

    function test_Expire_UnknownPromise() public {
        vm.expectRevert(PromiseEscrow.NotOpen.selector);
        escrow.expire(keccak256("nope"));
    }

    // two promises don't touch each other's money

    function test_PromisesAreIsolated() public {
        _create();
        bytes32 id2 = keccak256("promise-2");
        address maker2 = makeAddr("maker2");
        usdc.mint(maker2, 3e6);
        vm.startPrank(maker2);
        usdc.approve(address(escrow), 3e6);
        escrow.createPromise(id2, beneficiary, 3e6, deadline);
        vm.stopPrank();

        vm.prank(agent);
        escrow.settle(id, false);
        assertEq(usdc.balanceOf(beneficiary), STAKE);
        assertEq(usdc.balanceOf(address(escrow)), 3e6);
        assertEq(escrow.totalLiabilities(), 3e6);
    }

    function _countLogs(bytes32 topic) internal view returns (uint256 n) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(escrow) && logs[i].topics[0] == topic) n++;
        }
    }
}

contract PromiseEscrowReentrancyTest is Test {
    ReentrantToken token;
    PromiseEscrow escrow;
    address agent = makeAddr("agent");
    address maker = makeAddr("maker");
    address beneficiary = makeAddr("beneficiary");
    bytes32 id = keccak256("p");
    uint64 deadline;

    function setUp() public {
        token = new ReentrantToken();
        escrow = new PromiseEscrow(IERC20(address(token)), agent, 1 hours);
        deadline = uint64(block.timestamp + 1 days);
        token.mint(maker, 10e6);
        vm.startPrank(maker);
        token.approve(address(escrow), type(uint256).max);
        escrow.createPromise(id, beneficiary, 5e6, deadline);
        vm.stopPrank();
    }

    function test_ReentrantExpireIsBlocked() public {
        vm.warp(deadline + 1 hours + 1);
        token.arm(address(escrow), abi.encodeCall(PromiseEscrow.expire, (id)));

        escrow.expire(id);

        assertTrue(token.attempted());
        assertFalse(token.reentered());
        assertEq(bytes4(token.lastError()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(token.balanceOf(maker), 10e6);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_ReentrantCreateIsBlocked() public {
        token.arm(
            address(escrow), abi.encodeCall(PromiseEscrow.createPromise, (keccak256("q"), beneficiary, 1e6, deadline))
        );

        vm.prank(maker);
        escrow.createPromise(keccak256("p2"), beneficiary, 1e6, deadline);

        assertFalse(token.reentered());
        assertEq(bytes4(token.lastError()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(uint8(escrow.getPromise(keccak256("q")).status), uint8(PromiseEscrow.Status.None));
    }

    function test_ReentrantExpireDuringSettleIsBlocked() public {
        vm.warp(deadline + 1 hours + 1);
        token.arm(address(escrow), abi.encodeCall(PromiseEscrow.expire, (id)));

        vm.prank(agent);
        escrow.settle(id, true);

        assertFalse(token.reentered());
        assertEq(bytes4(token.lastError()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(token.balanceOf(maker), 10e6);
        assertEq(token.balanceOf(address(escrow)), 0);
    }
}

contract PromiseEscrowFuzzTest is Test {
    MockUSDC usdc;
    PromiseEscrow escrow;
    address agent = makeAddr("agent");
    address maker = makeAddr("maker");
    address beneficiary = makeAddr("beneficiary");

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new PromiseEscrow(IERC20(address(usdc)), agent, 72 hours);
    }

    /// outcome: 0 = kept, 1 = broken, 2 = expired
    function testFuzz_PayoutsMatchDeposits(uint96 stake, uint96[20] memory amounts, uint8 nBackers, uint8 outcome)
        public
    {
        stake = uint96(bound(stake, 1, 1e15));
        nBackers = uint8(bound(nBackers, 0, 20));
        outcome = uint8(bound(outcome, 0, 2));
        bytes32 id = keccak256(abi.encode(stake, nBackers));
        uint64 deadline = uint64(block.timestamp + 1 days);

        usdc.mint(maker, stake);
        vm.startPrank(maker);
        usdc.approve(address(escrow), stake);
        escrow.createPromise(id, beneficiary, stake, deadline);
        vm.stopPrank();

        uint256 deposited = stake;
        for (uint256 i; i < nBackers; ++i) {
            uint256 amt = bound(amounts[i], 1, 1e15);
            address backer = address(uint160(0xBEEF00 + i));
            usdc.mint(address(escrow), amt);
            vm.prank(agent);
            escrow.creditBacking(id, backer, amt, keccak256(abi.encode(i)));
            deposited += amt;
        }
        assertEq(usdc.balanceOf(address(escrow)), deposited);

        if (outcome == 2) {
            vm.warp(uint256(deadline) + 72 hours + 1);
            escrow.expire(id);
        } else {
            vm.prank(agent);
            escrow.settle(id, outcome == 0);
        }

        uint256 paidOut = usdc.balanceOf(maker) + usdc.balanceOf(beneficiary);
        for (uint256 i; i < nBackers; ++i) {
            address backer = address(uint160(0xBEEF00 + i));
            uint256 bal = usdc.balanceOf(backer);
            paidOut += bal;
            if (outcome == 1) assertEq(bal, 0);
            else assertEq(bal, escrow.backing(id, backer));
        }

        assertEq(paidOut, deposited, "payouts == deposits");
        assertEq(usdc.balanceOf(address(escrow)), 0, "nothing left behind");
        assertEq(escrow.totalLiabilities(), 0);
        if (outcome == 1) assertEq(usdc.balanceOf(beneficiary), deposited);
        else assertEq(usdc.balanceOf(maker), stake);
    }
}
