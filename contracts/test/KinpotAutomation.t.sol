// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Kinpot} from "../src/Kinpot.sol";
import {IReceiver, KinpotAutomation} from "../src/KinpotAutomation.sol";
import {MockAUSD} from "../src/mocks/MockAUSD.sol";
import {KinpotBase} from "./utils/KinpotBase.sol";

contract KinpotAutomationTest is KinpotBase {
    MockAUSD internal ausd;
    KinpotAutomation internal automation;
    address internal creForwarder = makeAddr("creForwarder");
    address internal simForwarder = makeAddr("simForwarder");

    function setUp() public {
        vm.warp(1_760_000_000);
        _makeActors();
        ausd = new MockAUSD();
        _deployKinpot(IERC20(address(ausd)));
        automation = new KinpotAutomation(kinpot, creForwarder, simForwarder);
        ausd.mint(organizer, 10_000e6);
        vm.prank(organizer);
        ausd.approve(address(kinpot), type(uint256).max);
    }

    /// Pot 1: funded + confirmed, due in 1 day.  Pot 2: funded, never confirmed, expires in 2 days.
    /// Pot 3: still collecting.
    function _scenario() internal {
        uint256 a = _createPot(100e6, 1 days, 30 days);
        vm.startPrank(organizer);
        kinpot.contribute(a, 100e6);
        vm.stopPrank();
        vm.prank(payee);
        kinpot.confirmBill(a);

        uint256 b = _createPot(50e6, 1 hours, 2 days);
        vm.prank(organizer);
        kinpot.contribute(b, 50e6);

        _createPot(70e6, 1 days, 30 days);
    }

    function test_pending_findsNothingEarly() public {
        _scenario();
        (uint256[] memory rel, uint256[] memory ref) = automation.pending(1, 100);
        assertEq(rel.length, 0);
        assertEq(ref.length, 0);
    }

    function test_pending_findsDueAndExpired() public {
        _scenario();
        vm.warp(block.timestamp + 2 days + 1);
        (uint256[] memory rel, uint256[] memory ref) = automation.pending(0, 100);
        assertEq(rel.length, 1);
        assertEq(rel[0], 1);
        assertEq(ref.length, 1);
        assertEq(ref[0], 2);
    }

    function test_onReport_paysAndRefunds() public {
        _scenario();
        vm.warp(block.timestamp + 2 days + 1);
        (uint256[] memory rel, uint256[] memory ref) = automation.pending(1, 100);

        vm.prank(creForwarder);
        automation.onReport("", abi.encode(rel, ref));

        assertEq(uint8(kinpot.getPot(1).status), uint8(Kinpot.Status.Paid));
        assertEq(ausd.balanceOf(payee), 100e6);
        assertTrue(kinpot.getPot(2).refunded);
        assertEq(ausd.balanceOf(organizer), 10_000e6 - 100e6);
    }

    function test_onReport_skipsBadIdsWithoutReverting() public {
        _scenario();
        uint256[] memory rel = new uint256[](2);
        rel[0] = 3; // still collecting
        rel[1] = 99; // doesn't exist
        uint256[] memory ref = new uint256[](1);
        ref[0] = 1; // not refundable

        vm.expectEmit(address(automation));
        emit KinpotAutomation.AutoSkipped(3, true);
        vm.prank(simForwarder);
        automation.onReport("", abi.encode(rel, ref));
        assertEq(uint8(kinpot.getPot(1).status), uint8(Kinpot.Status.Open));
    }

    function test_onReport_onlyForwarders() public {
        vm.expectRevert(abi.encodeWithSelector(KinpotAutomation.InvalidSender.selector, address(this)));
        automation.onReport("", abi.encode(new uint256[](0), new uint256[](0)));
    }

    function test_onReport_capsBatch() public {
        vm.prank(creForwarder);
        vm.expectRevert(KinpotAutomation.BatchTooLarge.selector);
        automation.onReport("", abi.encode(new uint256[](40), new uint256[](11)));
    }

    function test_supportsInterface() public view {
        assertTrue(automation.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(automation.supportsInterface(type(IERC165).interfaceId));
        assertFalse(automation.supportsInterface(0xdeadbeef));
    }
}
