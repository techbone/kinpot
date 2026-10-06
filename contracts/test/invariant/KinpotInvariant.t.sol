// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Kinpot} from "../../src/Kinpot.sol";
import {MockAUSD} from "../../src/mocks/MockAUSD.sol";

/// Drives Kinpot with random sequences of every user action and time jumps.
contract Handler is Test {
    Kinpot public kinpot;
    MockAUSD public ausd;

    address[] public people;
    address public payeeA = makeAddr("payeeA");
    address public payeeB = makeAddr("payeeB");

    // Ghost accounting.
    mapping(address => uint256) public putIn;
    mapping(address => uint256) public gotBack;
    uint256 public paidToPayees;
    uint256 public expectedPaidToPayees;
    bool public releasedWithoutConditions;

    constructor(Kinpot kinpot_, MockAUSD ausd_) {
        kinpot = kinpot_;
        ausd = ausd_;
        for (uint256 i; i < 4; ++i) {
            address p = makeAddr(string.concat("sibling", vm.toString(i)));
            people.push(p);
            ausd.mint(p, 10_000e6);
            vm.prank(p);
            ausd.approve(address(kinpot), type(uint256).max);
        }
    }

    function _person(uint256 seed) internal view returns (address) {
        return people[seed % people.length];
    }

    function _pot(uint256 seed) internal view returns (uint256) {
        uint256 n = kinpot.potCount();
        return n == 0 ? 0 : (seed % n) + 1;
    }

    function createPot(uint256 who, uint256 target, uint256 dueIn, uint256 window, bool payeeChoice) external {
        target = bound(target, 1, 5_000e6);
        dueIn = bound(dueIn, 0, 10 days);
        window = bound(window, 1, 20 days);
        uint40 due = uint40(block.timestamp + dueIn);
        vm.prank(_person(who));
        kinpot.createPot(payeeChoice ? payeeA : payeeB, target, due, due + uint40(window), keccak256("bill"));
    }

    function contribute(uint256 who, uint256 potSeed, uint256 amount) external {
        uint256 id = _pot(potSeed);
        if (id == 0) return;
        address p = _person(who);
        uint256 left = kinpot.remaining(id);
        if (left == 0) return;
        amount = bound(amount, 1, left);
        if (ausd.balanceOf(p) < amount) return;
        vm.prank(p);
        try kinpot.contribute(id, amount) {
            putIn[p] += amount;
        } catch {}
    }

    function confirm(uint256 potSeed) external {
        uint256 id = _pot(potSeed);
        if (id == 0) return;
        vm.prank(kinpot.getPot(id).payee);
        try kinpot.confirmBill(id) {} catch {}
    }

    function decline(uint256 potSeed) external {
        uint256 id = _pot(potSeed);
        if (id == 0) return;
        vm.prank(kinpot.getPot(id).payee);
        try kinpot.declineBill(id) {} catch {}
    }

    function cancel(uint256 potSeed) external {
        uint256 id = _pot(potSeed);
        if (id == 0) return;
        vm.prank(kinpot.getPot(id).organizer);
        try kinpot.cancel(id) {} catch {}
    }

    function release(uint256 potSeed) external {
        uint256 id = _pot(potSeed);
        if (id == 0) return;
        Kinpot.Pot memory before = kinpot.getPot(id);
        bool ok = before.status == Kinpot.Status.Open && before.payeeConfirmed && before.raised == before.target
            && block.timestamp >= before.dueAt && block.timestamp <= before.expiresAt;
        uint256 payeeBefore = ausd.balanceOf(before.payee);
        try kinpot.release(id) {
            if (!ok) releasedWithoutConditions = true;
            paidToPayees += ausd.balanceOf(before.payee) - payeeBefore;
            expectedPaidToPayees += before.target;
        } catch {}
    }

    function refund(uint256 potSeed) external {
        uint256 id = _pot(potSeed);
        if (id == 0) return;
        uint256[] memory before = new uint256[](people.length);
        for (uint256 i; i < people.length; ++i) before[i] = ausd.balanceOf(people[i]);
        try kinpot.refund(id) {
            for (uint256 i; i < people.length; ++i) gotBack[people[i]] += ausd.balanceOf(people[i]) - before[i];
        } catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 5 days));
    }

    function peopleCount() external view returns (uint256) {
        return people.length;
    }
}

contract KinpotInvariantTest is Test {
    Kinpot internal kinpot;
    MockAUSD internal ausd;
    Handler internal handler;

    function setUp() public {
        vm.warp(1_760_000_000);
        ausd = new MockAUSD();
        kinpot = new Kinpot(IERC20(address(ausd)), address(0xF0));
        handler = new Handler(kinpot, ausd);
        targetContract(address(handler));
    }

    /// I2: per pot, the recorded contributions add up to `raised`, which never exceeds the target.
    function invariant_I2_contributionsSumToRaised() public view {
        for (uint256 id = 1; id <= kinpot.potCount(); ++id) {
            Kinpot.Pot memory pot = kinpot.getPot(id);
            address[] memory cs = kinpot.contributorsOf(id);
            uint256 sum;
            for (uint256 i; i < cs.length; ++i) sum += kinpot.contributed(id, cs[i]);
            assertEq(sum, pot.raised);
            assertLe(pot.raised, pot.target);
        }
    }

    /// I3: the contract holds exactly what it still owes: unpaid, unrefunded pots plus failed refunds.
    function invariant_I3_solvent() public view {
        uint256 owed;
        for (uint256 id = 1; id <= kinpot.potCount(); ++id) {
            Kinpot.Pot memory pot = kinpot.getPot(id);
            if (pot.status != Kinpot.Status.Paid && !pot.refunded) owed += pot.raised;
            address[] memory cs = kinpot.contributorsOf(id);
            for (uint256 i; i < cs.length; ++i) owed += kinpot.refundOwed(id, cs[i]);
        }
        assertEq(ausd.balanceOf(address(kinpot)), owed);
    }

    /// I4: a paid pot is never refunded, and a refunded pot is never paid.
    function invariant_I4_terminalStatesExclusive() public view {
        for (uint256 id = 1; id <= kinpot.potCount(); ++id) {
            Kinpot.Pot memory pot = kinpot.getPot(id);
            if (pot.status == Kinpot.Status.Paid) assertFalse(pot.refunded);
            if (pot.refunded) assertEq(uint8(pot.status), uint8(Kinpot.Status.Closed));
        }
    }

    /// I1 + I5: payees received exactly the targets of pots that met every release condition.
    function invariant_I1_I5_payeesGetExactlyReleasedTargets() public view {
        assertFalse(handler.releasedWithoutConditions());
        assertEq(handler.paidToPayees(), handler.expectedPaidToPayees());
        assertEq(ausd.balanceOf(handler.payeeA()) + ausd.balanceOf(handler.payeeB()), handler.paidToPayees());
    }

    /// I6: nobody is refunded more than they put in.
    function invariant_I6_refundsNeverExceedContributions() public view {
        for (uint256 i; i < handler.peopleCount(); ++i) {
            address p = handler.people(i);
            assertLe(handler.gotBack(p), handler.putIn(p));
        }
    }
}
