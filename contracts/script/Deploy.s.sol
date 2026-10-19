// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PromiseEscrow} from "../src/PromiseEscrow.sol";

contract Deploy is Script {
    function run() external returns (PromiseEscrow escrow) {
        address usdc = vm.envAddress("USDC_ADDRESS");
        address agent = vm.envAddress("AGENT_ADDRESS");
        uint64 grace = uint64(vm.envOr("GRACE_PERIOD", uint256(72 hours)));

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        escrow = new PromiseEscrow(IERC20(usdc), agent, grace);
        vm.stopBroadcast();

        console.log("PromiseEscrow:", address(escrow));
    }
}
