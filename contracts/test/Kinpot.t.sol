// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Kinpot} from "../src/Kinpot.sol";
import {MockAUSD} from "../src/mocks/MockAUSD.sol";
import {KinpotBase} from "./utils/KinpotBase.sol";

/// @dev AUSD with an issuer-style blocklist, to test per-contributor refund isolation.
contract BlockableAUSD is MockAUSD {
    mapping(address => bool) public blocked;

    function setBlocked(address who, bool value) external {
        blocked[who] = value;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[from] && !blocked[to], "blocked");
        super._update(from, to, value);
    }
}

contract KinpotTest is KinpotBase {
    BlockableAUSD internal ausd;

    uint256 internal constant BILL_AMOUNT = 480e6;

    function setUp() public {
        vm.warp(1_760_000_000);
        _makeActors();
        ausd = new BlockableAUSD();
        _deployKinpot(IERC20(address(ausd)));
        ausd.mint(organizer, 1_000e6);
        ausd.mint(kemi, 1_000e6);
        ausd.mint(femi, 1_000e6);
        vm.prank(organizer);
        ausd.approve(address(kinpot), type(uint256).max);
    }

    // ---------------------------------------------------------------------------------------------
    // createPot
    // ---------------------------------------------------------------------------------------------

    function test_createPot_storesEverything() public {
        uint256 id = _createPot(BILL_AMOUNT, 1 days, 30 days);
        assertEq(id, 1);
        Kinpot.Pot memory pot = kinpot.getPot(id);
        assertEq(pot.organizer, organizer);
        assertEq(pot.payee, payee);
        assertEq(pot.target, BILL_AMOUNT);
        assertEq(pot.raised, 0);
        assertEq(pot.dueAt, block.timestamp + 1 days);
        assertEq(pot.expiresAt, block.timestamp + 30 days);
        assertEq(uint8(pot.status), uint8(Kinpot.Status.Open));
        assertEq(pot.billHash, BILL);
        assertFalse(pot.payeeConfirmed);
    }

    function test_createPot_rejectsBadPayee() public {
        uint40 t = uint40(block.timestamp);
        vm.startPrank(organizer);
        vm.expectRevert(Kinpot.InvalidPayee.selector);
        kinpot.createPot(address(0), 1e6, t, t + 1 days, BILL);
        vm.expectRevert(Kinpot.InvalidPayee.selector);
        kinpot.createPot(organizer, 1e6, t, t + 1 days, BILL);
        vm.expectRevert(Kinpot.InvalidPayee.selector);
        kinpot.createPot(address(kinpot), 1e6, t, t + 1 days, BILL);
        vm.stopPrank();
    }

    function test_createPot_rejectsBadAmount() public {
        uint40 t = uint40(block.timestamp);
        vm.startPrank(organizer);
        vm.expectRevert(Kinpot.InvalidAmount.selector);
        kinpot.createPot(payee, 0, t, t + 1 days, BILL);
        vm.expectRevert(Kinpot.InvalidAmount.selector);
        kinpot.createPot(payee, uint256(type(uint96).max) + 1, t, t + 1 days, BILL);
        vm.stopPrank();
    }

    function test_createPot_rejectsBadSchedule() public {
        uint40 t = uint40(block.timestamp);
        vm.startPrank(organizer);
        vm.expectRevert(Kinpot.InvalidSchedule.selector);
        kinpot.createPot(payee, 1e6, t - 1, t + 1 days, BILL); // due in the past
        vm.expectRevert(Kinpot.InvalidSchedule.selector);
        kinpot.createPot(payee, 1e6, t + 1 days, t + 1 days, BILL); // expiry not after due
        vm.expectRevert(Kinpot.InvalidSchedule.selector);
        kinpot.createPot(payee, 1e6, t, t + 366 days, BILL); // too long
        vm.stopPrank();
    }

    function test_createPot_viaForwarderSetsSignerAsOrganizer() public {
        uint40 t = uint40(block.timestamp);
        _forward(organizerKey, organizer, abi.encodeCall(Kinpot.createPot, (payee, BILL_AMOUNT, t, t + 7 days, BILL)));
        assertEq(kinpot.getPot(1).organizer, organizer);
    }

    // ---------------------------------------------------------------------------------------------
    // contribute
    // ---------------------------------------------------------------------------------------------

    function test_contribute_direct() public {
        uint256 id = _createPot(BILL_AMOUNT, 1 days, 30 days);
        vm.prank(organizer);
        kinpot.contribute(id, 200e6);
        assertEq(kinpot.contributed(id, organizer), 200e6);
        assertEq(kinpot.getPot(id).raised, 200e6);
        assertEq(ausd.balanceOf(address(kinpot)), 200e6);
        assertEq(kinpot.contributorsOf(id).length, 1);
    }

    function test_contribute_withAuthorization_creditsSignerNotRelayer() public {
        uint256 id = _createPot(BILL_AMOUNT, 1 days, 30 days);
        _contributeWithAuth(kemiKey, kemi, id, 150e6, bytes32("s1"));
        assertEq(kinpot.contributed(id, kemi), 150e6);
        assertEq(kinpot.contributed(id, relayer), 0);
        assertEq(ausd.balanceOf(kemi), 850e6);
        assertEq(ausd.balanceOf(address(kinpot)), 150e6);
    }

    function test_contribute_withAuthorization_cannotBeRedirectedToAnotherPot() public {
        uint256 a = _createPot(BILL_AMOUNT, 1 days, 30 days);
        uint256 b = _createPot(BILL_AMOUNT, 1 days, 30 days);
        Auth memory auth = _signReceive(kemiKey, kemi, a, 150e6, bytes32("s1"));
        vm.prank(relayer);
        vm.expectRevert(MockAUSD.InvalidSignature.selector);
        kinpot.contributeWithAuthorization(
            b, kemi, 150e6, auth.validAfter, auth.validBefore, auth.salt, auth.v, auth.r, auth.s
        );
    }

    function test_contribute_withAuthorization_cannotBeReplayed() public {
        uint256 id = _createPot(BILL_AMOUNT, 1 days, 30 days);
        Auth memory auth = _signReceive(kemiKey, kemi, id, 100e6, bytes32("s1"));
        vm.startPrank(relayer);
        kinpot.contributeWithAuthorization(id, kemi, 100e6, auth.validAfter, auth.validBefore, auth.salt, auth.v, auth.r, auth.s);
        vm.expectRevert(MockAUSD.AuthorizationUsedAlready.selector);
        kinpot.contributeWithAuthorization(id, kemi, 100e6, auth.validAfter, auth.validBefore, auth.salt, auth.v, auth.r, auth.s);
        vm.stopPrank();
    }

    function test_contribute_withAuthorization_wrongAmountFails() public {
        uint256 id = _createPot(BILL_AMOUNT, 1 days, 30 days);
        Auth memory auth = _signReceive(kemiKey, kemi, id, 100e6, bytes32("s1"));
        vm.prank(relayer);
        vm.expectRevert(MockAUSD.InvalidSignature.selector);
        kinpot.contributeWithAuthorization(id, kemi, 200e6, auth.validAfter, auth.validBefore, auth.salt, auth.v, auth.r, auth.s);
    }

    function test_contribute_rejectsOverfunding() public {
        uint256 id = _createPot(BILL_AMOUNT, 1 days, 30 days);
        vm.prank(organizer);
        kinpot.contribute(id, 400e6);
        vm.prank(organizer);
        vm.expectRevert(abi.encodeWithSelector(Kinpot.ExceedsRemaining.selector, 80e6));
        kinpot.contribute(id, 81e6);
    }

    function test_contribute_rejectsZero() public {
        uint256 id = _createPot(BILL_AMOUNT, 1 days, 30 days);
        vm.prank(organizer);
        vm.expectRevert(Kinpot.InvalidAmount.selector);
        kinpot.contribute(id, 0);
    }

    function test_contribute_rejectsUnknownPot() public {
        vm.prank(organizer);
        vm.expectRevert(Kinpot.PotNotOpen.selector);
        kinpot.contribute(99, 1e6);
    }

    function test_contribute_rejectsAfterExpiry() public {
        uint256 id = _createPot(BILL_AMOUNT, 1 days, 30 days);
        vm.warp(block.timestamp + 30 days + 1);
        vm.prank(organizer);
        vm.expectRevert(Kinpot.PotExpired.selector);
        kinpot.contribute(id, 1e6);
    }

    function test_contribute_topUpDoesNotDuplicateContributor() public {
        uint256 id = _createPot(BILL_AMOUNT, 1 days, 30 days);
        vm.startPrank(organizer);
        kinpot.contribute(id, 100e6);
        kinpot.contribute(id, 100e6);
        vm.stopPrank();
        assertEq(kinpot.contributorsOf(id).length, 1);
        assertEq(kinpot.contributed(id, organizer), 200e6);
    }

    function test_contribute_capsContributors() public {
        uint256 id = _createPot(1_000e6, 1 days, 30 days);
        for (uint256 i; i < kinpot.MAX_CONTRIBUTORS(); ++i) {
            address who = address(uint160(0x1000 + i));
            ausd.mint(who, 1e6);
            vm.startPrank(who);
            ausd.approve(address(kinpot), 1e6);
            kinpot.contribute(id, 1e6);
            vm.stopPrank();
        }
        vm.prank(organizer);
        vm.expectRevert(Kinpot.TooManyContributors.selector);
        kinpot.contribute(id, 1e6);
    }

    // ---------------------------------------------------------------------------------------------
    // payee
    // ---------------------------------------------------------------------------------------------

    function test_confirmBill_onlyPayee() public {
        uint256 id = _createPot(BILL_AMOUNT, 1 days, 30 days);
        vm.prank(organizer);
        vm.expectRevert(Kinpot.NotPayee.selector);
        kinpot.confirmBill(id);
        vm.prank(payee);
        kinpot.confirmBill(id);
        assertTrue(kinpot.getPot(id).payeeConfirmed);
    }

    function test_confirmBill_viaForwarder() public {
        uint256 id = _createPot(BILL_AMOUNT, 1 days, 30 days);
        _forward(payeeKey, payee, abi.encodeCall(Kinpot.confirmBill, (id)));
        assertTrue(kinpot.getPot(id).payeeConfirmed);
    }

    function test_confirmBill_rejectsAfterExpiry() public {
        uint256 id = _createPot(BILL_AMOUNT, 1 days, 30 days);
        vm.warp(block.timestamp + 30 days + 1);
        vm.prank(payee);
        vm.expectRevert(Kinpot.PotExpired.selector);
        kinpot.confirmBill(id);
    }

    function test_declineBill_closesAndRefunds() public {
        uint256 id = _fundedPot();
        vm.prank(payee);
        kinpot.declineBill(id);
        assertEq(uint8(kinpot.getPot(id).status), uint8(Kinpot.Status.Closed));
        kinpot.refund(id);
        _assertEveryoneMadeWhole();
    }

    // ---------------------------------------------------------------------------------------------
    // release
    // ---------------------------------------------------------------------------------------------

    function test_release_paysPayeeExactlyOnce() public {
        uint256 id = _fundedPot();
        vm.prank(payee);
        kinpot.confirmBill(id);
        vm.warp(block.timestamp + 1 days);

        assertTrue(kinpot.canRelease(id));
        vm.prank(makeAddr("anyone"));
        kinpot.release(id);

        assertEq(ausd.balanceOf(payee), BILL_AMOUNT);
        assertEq(ausd.balanceOf(address(kinpot)), 0);
        assertEq(uint8(kinpot.getPot(id).status), uint8(Kinpot.Status.Paid));

        vm.expectRevert(Kinpot.NotReleasable.selector);
        kinpot.release(id);
        vm.expectRevert(Kinpot.NotRefundable.selector);
        kinpot.refund(id);
    }

    function test_release_requiresConfirmation() public {
        uint256 id = _fundedPot();
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(Kinpot.NotReleasable.selector);
        kinpot.release(id);
    }

    function test_release_requiresDueDate() public {
        uint256 id = _fundedPot();
        vm.prank(payee);
        kinpot.confirmBill(id);
        vm.warp(block.timestamp + 1 days - 1);
        vm.expectRevert(Kinpot.NotReleasable.selector);
        kinpot.release(id);
    }

    function test_release_requiresFullFunding() public {
        uint256 id = _createPot(BILL_AMOUNT, 0, 30 days);
        vm.prank(organizer);
        kinpot.contribute(id, BILL_AMOUNT - 1);
        vm.prank(payee);
        kinpot.confirmBill(id);
        vm.expectRevert(Kinpot.NotReleasable.selector);
        kinpot.release(id);
    }

    function test_release_notAfterExpiry() public {
        uint256 id = _fundedPot();
        vm.prank(payee);
        kinpot.confirmBill(id);
        vm.warp(block.timestamp + 30 days + 1);
        assertFalse(kinpot.canRelease(id));
        assertTrue(kinpot.canRefund(id));
        vm.expectRevert(Kinpot.NotReleasable.selector);
        kinpot.release(id);
    }

    function test_release_payAsSoonAsFunded() public {
        uint256 id = _createPot(BILL_AMOUNT, 0, 7 days);
        vm.prank(payee);
        kinpot.confirmBill(id);
        vm.prank(organizer);
        kinpot.contribute(id, BILL_AMOUNT);
        kinpot.release(id);
        assertEq(ausd.balanceOf(payee), BILL_AMOUNT);
    }

    // ---------------------------------------------------------------------------------------------
    // cancel / refund
    // ---------------------------------------------------------------------------------------------

    function test_cancel_onlyOrganizer() public {
        uint256 id = _fundedPot();
        vm.prank(kemi);
        vm.expectRevert(Kinpot.NotOrganizer.selector);
        kinpot.cancel(id);
        vm.prank(organizer);
        kinpot.cancel(id);
        assertTrue(kinpot.canRefund(id));
        kinpot.refund(id);
        _assertEveryoneMadeWhole();
    }

    function test_cancel_viaForwarder() public {
        uint256 id = _fundedPot();
        _forward(organizerKey, organizer, abi.encodeCall(Kinpot.cancel, (id)));
        assertEq(uint8(kinpot.getPot(id).status), uint8(Kinpot.Status.Closed));
    }

    function test_refund_onlyAfterExpiryWhileOpen() public {
        uint256 id = _fundedPot();
        vm.expectRevert(Kinpot.NotRefundable.selector);
        kinpot.refund(id);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(Kinpot.NotRefundable.selector);
        kinpot.refund(id);
        vm.warp(block.timestamp + 1);
        kinpot.refund(id);
        _assertEveryoneMadeWhole();
        vm.expectRevert(Kinpot.NotRefundable.selector);
        kinpot.refund(id);
    }

    function test_refund_isolatesBlockedContributor() public {
        uint256 id = _fundedPot();
        ausd.setBlocked(kemi, true);
        vm.prank(organizer);
        kinpot.cancel(id);
        kinpot.refund(id);

        assertEq(ausd.balanceOf(organizer), 1_000e6);
        assertEq(ausd.balanceOf(femi), 1_000e6);
        assertEq(kinpot.refundOwed(id, kemi), 150e6);
        assertEq(ausd.balanceOf(address(kinpot)), 150e6);

        ausd.setBlocked(kemi, false);
        vm.prank(kemi);
        kinpot.claimRefund(id);
        assertEq(ausd.balanceOf(kemi), 1_000e6);
        assertEq(ausd.balanceOf(address(kinpot)), 0);

        vm.prank(kemi);
        vm.expectRevert(Kinpot.NothingOwed.selector);
        kinpot.claimRefund(id);
    }

    function test_cannotCancelOrDeclineClosedPot() public {
        uint256 id = _fundedPot();
        vm.prank(organizer);
        kinpot.cancel(id);
        vm.prank(organizer);
        vm.expectRevert(Kinpot.PotNotOpen.selector);
        kinpot.cancel(id);
        vm.prank(payee);
        vm.expectRevert(Kinpot.PotNotOpen.selector);
        kinpot.declineBill(id);
    }

    // ---------------------------------------------------------------------------------------------
    // fuzz
    // ---------------------------------------------------------------------------------------------

    function testFuzz_contributionsNeverExceedTarget(uint96 target, uint96[8] calldata amounts) public {
        target = uint96(bound(target, 1, 1_000_000e6));
        uint256 id = _createPot(target, 1 days, 30 days);
        uint256 sum;
        for (uint256 i; i < amounts.length; ++i) {
            address who = address(uint160(0x2000 + i));
            uint256 amount = bound(amounts[i], 1, 2_000_000e6);
            _mintTo(who, amount);
            vm.startPrank(who);
            ausd.approve(address(kinpot), amount);
            if (amount <= target - sum) {
                kinpot.contribute(id, amount);
                sum += amount;
            } else {
                vm.expectRevert();
                kinpot.contribute(id, amount);
            }
            vm.stopPrank();
        }
        assertEq(kinpot.getPot(id).raised, sum);
        assertLe(sum, target);
        assertEq(ausd.balanceOf(address(kinpot)), sum);
    }

    function testFuzz_refundReturnsExactAmounts(uint64 a, uint64 b, uint64 c) public {
        uint256 id = _createPot(type(uint96).max, 1 days, 30 days);
        address[3] memory who = [address(0xA1), address(0xB2), address(0xC3)];
        uint256[3] memory amt = [uint256(bound(a, 1, 1e12)), uint256(bound(b, 1, 1e12)), uint256(bound(c, 1, 1e12))];
        for (uint256 i; i < 3; ++i) {
            _mintTo(who[i], amt[i]);
            vm.startPrank(who[i]);
            ausd.approve(address(kinpot), amt[i]);
            kinpot.contribute(id, amt[i]);
            vm.stopPrank();
        }
        vm.prank(organizer);
        kinpot.cancel(id);
        kinpot.refund(id);
        for (uint256 i; i < 3; ++i) {
            assertEq(ausd.balanceOf(who[i]), amt[i]);
        }
        assertEq(ausd.balanceOf(address(kinpot)), 0);
    }

    // ---------------------------------------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------------------------------------

    /// Tobi $200 (direct), Kemi $150 and Femi $130 (both gasless), due in 1 day, expires in 30.
    function _fundedPot() internal returns (uint256 id) {
        id = _createPot(BILL_AMOUNT, 1 days, 30 days);
        vm.prank(organizer);
        kinpot.contribute(id, 200e6);
        _contributeWithAuth(kemiKey, kemi, id, 150e6, bytes32("kemi"));
        _contributeWithAuth(femiKey, femi, id, 130e6, bytes32("femi"));
        assertEq(kinpot.remaining(id), 0);
    }

    function _assertEveryoneMadeWhole() internal view {
        assertEq(ausd.balanceOf(organizer), 1_000e6);
        assertEq(ausd.balanceOf(kemi), 1_000e6);
        assertEq(ausd.balanceOf(femi), 1_000e6);
        assertEq(ausd.balanceOf(address(kinpot)), 0);
        assertEq(ausd.balanceOf(payee), 0);
    }

    function _mintTo(address to, uint256 amount) internal {
        while (amount > 0) {
            uint256 chunk = amount > ausd.MAX_MINT() ? ausd.MAX_MINT() : amount;
            ausd.mint(to, chunk);
            amount -= chunk;
        }
    }
}
