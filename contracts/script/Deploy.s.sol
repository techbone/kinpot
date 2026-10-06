// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {Kinpot} from "../src/Kinpot.sol";
import {KinpotAutomation} from "../src/KinpotAutomation.sol";
import {MockAUSD} from "../src/mocks/MockAUSD.sol";

/// @notice Mainnet (143) uses the real AUSD. Any other chain gets a MockAUSD anyone can mint.
///         Writes deployments/<chainId>.json for the web app and indexer.
contract Deploy is Script {
    address internal constant MAINNET_AUSD = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a;

    /// Chainlink CRE forwarders (docs.chain.link forwarder directory, code checked onchain 2026-10-06).
    function _creForwarders() internal view returns (address forwarder, address simulation) {
        if (block.chainid == 143) {
            return (0x76c9cf548b4179F8901cda1f8623568b58215E62, 0x9eF6468C5f37b976E57d52054c693269479A784d);
        }
        if (block.chainid == 10143) {
            return (0xF8344CFd5c43616a4366C34E3EEE75af79a74482, 0xB9F79d863261869B234c481D1f9A7af84AeAd192);
        }
        return (msg.sender, msg.sender); // local: the deployer stands in for the forwarder
    }

    function run() external {
        vm.startBroadcast();
        address ausd = block.chainid == 143 ? MAINNET_AUSD : address(new MockAUSD());
        ERC2771Forwarder forwarder = new ERC2771Forwarder("Kinpot");
        Kinpot kinpot = new Kinpot(IERC20(ausd), address(forwarder));
        (address creForwarder, address creSimulation) = _creForwarders();
        KinpotAutomation automation = new KinpotAutomation(kinpot, creForwarder, creSimulation);
        vm.stopBroadcast();

        console.log("AUSD     ", ausd);
        console.log("Forwarder", address(forwarder));
        console.log("Kinpot   ", address(kinpot));
        console.log("Automation", address(automation));

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "startBlock", block.number);
        vm.serializeBool(key, "mockAusd", block.chainid != 143);
        vm.serializeAddress(key, "ausd", ausd);
        vm.serializeAddress(key, "forwarder", address(forwarder));
        vm.serializeAddress(key, "automation", address(automation));
        string memory json = vm.serializeAddress(key, "kinpot", address(kinpot));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }
}
