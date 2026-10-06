// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Kinpot} from "../../src/Kinpot.sol";
import {KinpotBase} from "../utils/KinpotBase.sol";

/// @notice Runs the full gasless lifecycle against the real AUSD on Monad mainnet (fork).
contract KinpotMainnetAUSDTest is KinpotBase {
    IERC20 internal constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
    /// AUSD's balance storage isn't a plain mapping, so `deal` can't write it. Borrow from a holder.
    address internal constant HOLDER = 0x36eDbF0C834591BFdfCaC0Ef9605528c75c406aA;

    function setUp() public {
        vm.createSelectFork("monad");
        _makeActors();
        _deployKinpot(AUSD);
        vm.startPrank(HOLDER);
        AUSD.transfer(kemi, 500e6);
        AUSD.transfer(femi, 500e6);
        vm.stopPrank();
    }

    function test_fork_gaslessContributionsAndRelease() public {
        uint256 id = _createPot(280e6, 0, 7 days);
        _contributeWithAuth(kemiKey, kemi, id, 150e6, bytes32("kemi"));
        _contributeWithAuth(femiKey, femi, id, 130e6, bytes32("femi"));
        assertEq(AUSD.balanceOf(address(kinpot)), 280e6);

        _forward(payeeKey, payee, abi.encodeCall(Kinpot.confirmBill, (id)));
        kinpot.release(id);
        assertEq(AUSD.balanceOf(payee), 280e6);
        assertEq(AUSD.balanceOf(address(kinpot)), 0);
    }

    function test_fork_refundReturnsRealAUSD() public {
        uint256 id = _createPot(1_000e6, 1 days, 7 days);
        _contributeWithAuth(kemiKey, kemi, id, 150e6, bytes32("kemi"));
        vm.prank(payee);
        kinpot.declineBill(id);
        kinpot.refund(id);
        assertEq(AUSD.balanceOf(kemi), 500e6);
    }
}
