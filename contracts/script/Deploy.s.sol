// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {Kinpot} from "../src/Kinpot.sol";
import {MockAUSD} from "../src/mocks/MockAUSD.sol";

/// @notice Mainnet (143) uses the real AUSD. Any other chain gets a MockAUSD anyone can mint.
///         Writes deployments/<chainId>.json for the web app and indexer.
contract Deploy is Script {
    address internal constant MAINNET_AUSD = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a;

    function run() external {
        vm.startBroadcast();
        address ausd = block.chainid == 143 ? MAINNET_AUSD : address(new MockAUSD());
        ERC2771Forwarder forwarder = new ERC2771Forwarder("Kinpot");
        Kinpot kinpot = new Kinpot(IERC20(ausd), address(forwarder));
        vm.stopBroadcast();

        console.log("AUSD     ", ausd);
        console.log("Forwarder", address(forwarder));
        console.log("Kinpot   ", address(kinpot));

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "startBlock", block.number);
        vm.serializeBool(key, "mockAusd", block.chainid != 143);
        vm.serializeAddress(key, "ausd", ausd);
        vm.serializeAddress(key, "forwarder", address(forwarder));
        string memory json = vm.serializeAddress(key, "kinpot", address(kinpot));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }
}
