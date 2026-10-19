// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Calls back into a target on every transfer and remembers how that call went.
contract ReentrantToken is ERC20 {
    address public target;
    bytes public payload;
    bool public attempted;
    bool public reentered;
    bytes public lastError;

    constructor() ERC20("Evil", "EVIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        attempted = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (target != address(0) && !attempted && from != address(0)) {
            attempted = true;
            (bool ok, bytes memory err) = target.call(payload);
            reentered = ok;
            lastError = err;
        }
    }
}
