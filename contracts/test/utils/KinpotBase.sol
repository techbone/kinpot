// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC5267} from "@openzeppelin/contracts/interfaces/IERC5267.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {Kinpot} from "../../src/Kinpot.sol";

abstract contract KinpotBase is Test {
    bytes32 internal constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 internal constant FORWARD_TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
    );

    Kinpot internal kinpot;
    ERC2771Forwarder internal forwarder;
    IERC20 internal token;

    address internal organizer;
    uint256 internal organizerKey;
    address internal kemi;
    uint256 internal kemiKey;
    address internal femi;
    uint256 internal femiKey;
    address internal payee;
    uint256 internal payeeKey;
    address internal relayer = makeAddr("relayer");

    bytes32 internal constant BILL = keccak256("Dayo's school fees, 2nd semester");

    function _makeActors() internal {
        (organizer, organizerKey) = makeAddrAndKey("tobi");
        (kemi, kemiKey) = makeAddrAndKey("kemi");
        (femi, femiKey) = makeAddrAndKey("femi");
        (payee, payeeKey) = makeAddrAndKey("bursary");
    }

    function _deployKinpot(IERC20 token_) internal {
        token = token_;
        forwarder = new ERC2771Forwarder("Kinpot");
        kinpot = new Kinpot(token_, address(forwarder));
    }

    function _createPot(uint256 target, uint40 dueIn, uint40 expiresIn) internal returns (uint256) {
        vm.prank(organizer);
        return kinpot.createPot(
            payee, target, uint40(block.timestamp) + dueIn, uint40(block.timestamp) + expiresIn, BILL
        );
    }

    function _domainSeparator(address verifying) internal view returns (bytes32) {
        (, string memory name, string memory version, uint256 chainId, address contractAddr,,) =
            IERC5267(verifying).eip712Domain();
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                contractAddr
            )
        );
    }

    struct Auth {
        uint256 validAfter;
        uint256 validBefore;
        bytes32 salt;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function _signReceive(uint256 key, address from, uint256 potId, uint256 amount, bytes32 salt)
        internal
        view
        returns (Auth memory a)
    {
        a.validAfter = 0;
        a.validBefore = block.timestamp + 1 hours;
        a.salt = salt;
        bytes32 nonce = kinpot.authorizationNonce(potId, salt);
        bytes32 structHash =
            keccak256(abi.encode(RECEIVE_TYPEHASH, from, address(kinpot), amount, a.validAfter, a.validBefore, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(address(token)), structHash));
        (a.v, a.r, a.s) = vm.sign(key, digest);
    }

    function _contributeWithAuth(uint256 key, address from, uint256 potId, uint256 amount, bytes32 salt) internal {
        Auth memory a = _signReceive(key, from, potId, amount, salt);
        vm.prank(relayer);
        kinpot.contributeWithAuthorization(potId, from, amount, a.validAfter, a.validBefore, a.salt, a.v, a.r, a.s);
    }

    function _forward(uint256 key, address from, bytes memory data) internal {
        uint48 deadline = uint48(block.timestamp + 1 hours);
        uint256 nonce = forwarder.nonces(from);
        bytes32 structHash = keccak256(
            abi.encode(FORWARD_TYPEHASH, from, address(kinpot), uint256(0), uint256(300_000), nonce, deadline, keccak256(data))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(address(forwarder)), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        ERC2771Forwarder.ForwardRequestData memory req = ERC2771Forwarder.ForwardRequestData({
            from: from,
            to: address(kinpot),
            value: 0,
            gas: 300_000,
            deadline: deadline,
            data: data,
            signature: abi.encodePacked(r, s, v)
        });
        vm.prank(relayer);
        forwarder.execute(req);
    }
}
