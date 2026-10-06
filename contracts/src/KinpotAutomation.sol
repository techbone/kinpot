// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Kinpot} from "./Kinpot.sol";

/// @notice Chainlink CRE report receiver.
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @title KinpotAutomation
/// @notice Lets a Chainlink CRE workflow pay due pots and refund expired ones on schedule.
///         The workflow reads `pending`, then sends a signed report of pot IDs through the
///         Chainlink forwarder. Each ID is tried in isolation, so one bad pot can't block the rest.
/// @dev    `release` and `refund` are permissionless on Kinpot, so this contract holds no power
///         anyone else lacks. The forwarder check only keeps the event log meaningful.
contract KinpotAutomation is IReceiver {
    uint256 public constant MAX_BATCH = 50;
    uint256 public constant MAX_SCAN = 500;

    Kinpot public immutable kinpot;
    /// The Chainlink KeystoneForwarder used by deployed workflows.
    address public immutable forwarder;
    /// The MockKeystoneForwarder used by `cre workflow simulate --broadcast`.
    address public immutable simulationForwarder;

    event AutoReleased(uint256 indexed potId);
    event AutoRefunded(uint256 indexed potId);
    event AutoSkipped(uint256 indexed potId, bool release);

    error InvalidSender(address sender);
    error BatchTooLarge();
    error ZeroAddress();

    constructor(Kinpot kinpot_, address forwarder_, address simulationForwarder_) {
        if (address(kinpot_) == address(0) || forwarder_ == address(0) || simulationForwarder_ == address(0)) {
            revert ZeroAddress();
        }
        kinpot = kinpot_;
        forwarder = forwarder_;
        simulationForwarder = simulationForwarder_;
    }

    /// @param report abi.encode(uint256[] releaseIds, uint256[] refundIds)
    function onReport(bytes calldata, bytes calldata report) external {
        if (msg.sender != forwarder && msg.sender != simulationForwarder) revert InvalidSender(msg.sender);
        (uint256[] memory releaseIds, uint256[] memory refundIds) = abi.decode(report, (uint256[], uint256[]));
        if (releaseIds.length + refundIds.length > MAX_BATCH) revert BatchTooLarge();

        for (uint256 i; i < releaseIds.length; ++i) {
            try kinpot.release(releaseIds[i]) {
                emit AutoReleased(releaseIds[i]);
            } catch {
                emit AutoSkipped(releaseIds[i], true);
            }
        }
        for (uint256 i; i < refundIds.length; ++i) {
            try kinpot.refund(refundIds[i]) {
                emit AutoRefunded(refundIds[i]);
            } catch {
                emit AutoSkipped(refundIds[i], false);
            }
        }
    }

    /// @notice Pots that can be paid or refunded right now, scanning `count` IDs from `fromId`.
    ///         Results are capped at MAX_BATCH in total so they always fit in one report.
    function pending(uint256 fromId, uint256 count)
        external
        view
        returns (uint256[] memory releaseIds, uint256[] memory refundIds)
    {
        uint256 last = kinpot.potCount();
        if (fromId == 0) fromId = 1;
        if (count > MAX_SCAN) count = MAX_SCAN;
        uint256 end = fromId + count > last + 1 ? last + 1 : fromId + count;

        uint256[] memory rel = new uint256[](MAX_BATCH);
        uint256[] memory ref = new uint256[](MAX_BATCH);
        uint256 nRel = 0;
        uint256 nRef = 0;
        for (uint256 id = fromId; id < end && nRel + nRef < MAX_BATCH; ++id) {
            if (kinpot.canRelease(id)) rel[nRel++] = id;
            else if (kinpot.canRefund(id)) ref[nRef++] = id;
        }
        assembly {
            mstore(rel, nRel)
            mstore(ref, nRef)
        }
        return (rel, ref);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
