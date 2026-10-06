// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {IERC3009} from "./interfaces/IERC3009.sol";

/// @title Kinpot
/// @notice Escrow for family bills. Siblings co-fund a pot that is locked to one payee and one due
///         date. It pays the payee only when it is fully funded, the payee has confirmed the bill
///         and the due date has arrived. Otherwise every contributor gets back exactly what they put in.
/// @dev    No admin, pause, upgrade or fee. AUSD leaves this contract only to a pot's stored payee
///         or to its stored contributors. `release` and `refund` are permissionless.
contract Kinpot is ERC2771Context, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Open,
        Paid,
        Closed
    }

    struct Pot {
        address organizer;
        uint40 dueAt;
        uint40 expiresAt;
        Status status;
        bool payeeConfirmed;
        address payee;
        uint96 target;
        uint96 raised;
        bool refunded;
        bytes32 billHash;
    }

    uint256 public constant MAX_CONTRIBUTORS = 32;
    uint256 public constant MAX_DURATION = 365 days;

    IERC20 public immutable ausd;

    uint256 public potCount;

    mapping(uint256 potId => Pot) internal _pots;
    mapping(uint256 potId => address[]) internal _contributors;
    mapping(uint256 potId => mapping(address contributor => uint256)) public contributed;
    mapping(uint256 potId => mapping(address contributor => uint256)) public refundOwed;

    event PotCreated(
        uint256 indexed potId,
        address indexed organizer,
        address indexed payee,
        uint256 target,
        uint40 dueAt,
        uint40 expiresAt,
        bytes32 billHash
    );
    event Contributed(uint256 indexed potId, address indexed contributor, uint256 amount, uint256 raised);
    event BillConfirmed(uint256 indexed potId, address indexed payee);
    event BillDeclined(uint256 indexed potId, address indexed payee);
    event PotCancelled(uint256 indexed potId, address indexed organizer);
    event PotPaid(uint256 indexed potId, address indexed payee, uint256 amount);
    event PotClosed(uint256 indexed potId);
    event Refunded(uint256 indexed potId, address indexed contributor, uint256 amount);
    event RefundFailed(uint256 indexed potId, address indexed contributor, uint256 amount);

    error InvalidPayee();
    error InvalidAmount();
    error InvalidSchedule();
    error PotNotOpen();
    error PotExpired();
    error ExceedsRemaining(uint256 remaining);
    error TooManyContributors();
    error NotPayee();
    error NotOrganizer();
    error NotReleasable();
    error NotRefundable();
    error NothingOwed();

    constructor(IERC20 ausd_, address trustedForwarder) ERC2771Context(trustedForwarder) {
        ausd = ausd_;
    }

    // ---------------------------------------------------------------------------------------------
    // Organizer
    // ---------------------------------------------------------------------------------------------

    /// @notice Open a pot for one bill. The caller becomes its organizer.
    /// @param payee     The only address a release can pay.
    /// @param target    Bill amount in AUSD base units (6 dp).
    /// @param dueAt     Earliest time the bill can be paid. Use the current time to pay as soon as funded.
    /// @param expiresAt After this, an unpaid pot can only refund.
    /// @param billHash  keccak256 of the bill details kept off-chain.
    function createPot(address payee, uint256 target, uint40 dueAt, uint40 expiresAt, bytes32 billHash)
        external
        returns (uint256 potId)
    {
        address organizer = _msgSender();
        if (payee == address(0) || payee == organizer || payee == address(this)) revert InvalidPayee();
        if (target == 0 || target > type(uint96).max) revert InvalidAmount();
        if (dueAt < block.timestamp || expiresAt <= dueAt || expiresAt > block.timestamp + MAX_DURATION) {
            revert InvalidSchedule();
        }

        potId = ++potCount;
        Pot storage pot = _pots[potId];
        pot.organizer = organizer;
        pot.dueAt = dueAt;
        pot.expiresAt = expiresAt;
        pot.status = Status.Open;
        pot.payee = payee;
        pot.target = uint96(target);
        pot.billHash = billHash;

        emit PotCreated(potId, organizer, payee, target, dueAt, expiresAt, billHash);
    }

    /// @notice Call the pot off. Every contributor can then be refunded in full.
    function cancel(uint256 potId) external {
        Pot storage pot = _openPot(potId);
        if (_msgSender() != pot.organizer) revert NotOrganizer();
        pot.status = Status.Closed;
        emit PotCancelled(potId, pot.organizer);
        emit PotClosed(potId);
    }

    // ---------------------------------------------------------------------------------------------
    // Contributors
    // ---------------------------------------------------------------------------------------------

    /// @notice Contribute from an existing AUSD allowance. For wallets that pay their own gas.
    function contribute(uint256 potId, uint256 amount) external nonReentrant {
        address from = _msgSender();
        _recordContribution(potId, from, amount);
        ausd.safeTransferFrom(from, address(this), amount);
    }

    /// @notice Contribute with a signed EIP-3009 `ReceiveWithAuthorization`, so anyone (our relayer)
    ///         can submit it and the contributor never needs gas.
    /// @dev    The authorization nonce must be `keccak256(abi.encode(potId, salt))`. That binds the
    ///         signature to this pot, so a submitter cannot redirect it to another one.
    function contributeWithAuthorization(
        uint256 potId,
        address from,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        _recordContribution(potId, from, amount);
        IERC3009(address(ausd)).receiveWithAuthorization(
            from, address(this), amount, validAfter, validBefore, authorizationNonce(potId, salt), v, r, s
        );
    }

    /// @notice Pull a refund that could not be pushed earlier.
    function claimRefund(uint256 potId) external nonReentrant {
        address contributor = _msgSender();
        uint256 amount = refundOwed[potId][contributor];
        if (amount == 0) revert NothingOwed();
        refundOwed[potId][contributor] = 0;
        ausd.safeTransfer(contributor, amount);
        emit Refunded(potId, contributor, amount);
    }

    // ---------------------------------------------------------------------------------------------
    // Payee
    // ---------------------------------------------------------------------------------------------

    /// @notice The payee confirms the bill and amount are real and that they will accept payment.
    function confirmBill(uint256 potId) external {
        Pot storage pot = _openPot(potId);
        if (_msgSender() != pot.payee) revert NotPayee();
        if (block.timestamp > pot.expiresAt) revert PotExpired();
        pot.payeeConfirmed = true;
        emit BillConfirmed(potId, pot.payee);
    }

    /// @notice The payee does not recognise the bill. The pot closes and refunds.
    function declineBill(uint256 potId) external {
        Pot storage pot = _openPot(potId);
        if (_msgSender() != pot.payee) revert NotPayee();
        pot.status = Status.Closed;
        emit BillDeclined(potId, pot.payee);
        emit PotClosed(potId);
    }

    // ---------------------------------------------------------------------------------------------
    // Anyone
    // ---------------------------------------------------------------------------------------------

    /// @notice Pay the bill. Requires full funding, payee confirmation and the due date.
    function release(uint256 potId) external nonReentrant {
        if (!canRelease(potId)) revert NotReleasable();
        Pot storage pot = _pots[potId];
        pot.status = Status.Paid;
        ausd.safeTransfer(pot.payee, pot.target);
        emit PotPaid(potId, pot.payee, pot.target);
    }

    /// @notice Return every contribution of a closed or expired pot. A transfer that fails for one
    ///         contributor is recorded for `claimRefund` and does not block the others.
    function refund(uint256 potId) external nonReentrant {
        if (!canRefund(potId)) revert NotRefundable();
        Pot storage pot = _pots[potId];
        if (pot.status == Status.Open) {
            pot.status = Status.Closed;
            emit PotClosed(potId);
        }
        pot.refunded = true;

        address[] storage list = _contributors[potId];
        uint256 n = list.length;
        for (uint256 i; i < n; ++i) {
            address contributor = list[i];
            uint256 amount = contributed[potId][contributor];
            if (ausd.trySafeTransfer(contributor, amount)) {
                emit Refunded(potId, contributor, amount);
            } else {
                refundOwed[potId][contributor] = amount;
                emit RefundFailed(potId, contributor, amount);
            }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    function getPot(uint256 potId) external view returns (Pot memory) {
        return _pots[potId];
    }

    function contributorsOf(uint256 potId) external view returns (address[] memory) {
        return _contributors[potId];
    }

    function remaining(uint256 potId) public view returns (uint256) {
        Pot storage pot = _pots[potId];
        return pot.target - pot.raised;
    }

    function canRelease(uint256 potId) public view returns (bool) {
        Pot storage pot = _pots[potId];
        return pot.status == Status.Open && pot.payeeConfirmed && pot.raised == pot.target
            && block.timestamp >= pot.dueAt && block.timestamp <= pot.expiresAt;
    }

    function canRefund(uint256 potId) public view returns (bool) {
        Pot storage pot = _pots[potId];
        if (pot.refunded) return false;
        return pot.status == Status.Closed || (pot.status == Status.Open && block.timestamp > pot.expiresAt);
    }

    /// @notice The EIP-3009 nonce a contributor must sign for `contributeWithAuthorization`.
    function authorizationNonce(uint256 potId, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(potId, salt));
    }

    // ---------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------

    function _openPot(uint256 potId) internal view returns (Pot storage pot) {
        pot = _pots[potId];
        if (pot.status != Status.Open) revert PotNotOpen();
    }

    function _recordContribution(uint256 potId, address from, uint256 amount) internal {
        Pot storage pot = _openPot(potId);
        if (block.timestamp > pot.expiresAt) revert PotExpired();
        if (amount == 0) revert InvalidAmount();
        uint256 left = pot.target - pot.raised;
        if (amount > left) revert ExceedsRemaining(left);

        if (contributed[potId][from] == 0) {
            if (_contributors[potId].length == MAX_CONTRIBUTORS) revert TooManyContributors();
            _contributors[potId].push(from);
        }
        contributed[potId][from] += amount;
        pot.raised += uint96(amount);
        emit Contributed(potId, from, amount, pot.raised);
    }
}
