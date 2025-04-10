// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract DetectionLog {
    // Custom errors for better revert messages
    error InvalidResult(string result);
    error MediaIdAlreadyExists(string mediaId);
    error MediaIdNotFound(string mediaId);
    error UnauthorizedAccess(address caller);
    error ZeroAddressNotAllowed();
    
    struct Result {
        string result;  // "fake" or "real"
        uint256 timestamp; // Block timestamp
        address detector; // Address that submitted the result
    }
    
    // Events for better tracking
    event ResultLogged(
        string indexed mediaId,
        string result,
        uint256 timestamp,
        address indexed detector
    );
    
    // Removed ResultAccessed event since we can't emit in view functions
    event ResultUpdated(
        string indexed mediaId,
        string newResult,
        address indexed updater
    );
    event DetectorAuthorized(address indexed detector);
    event DetectorRevoked(address indexed detector);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    address private _owner;
    mapping(string => Result) private _results;
    mapping(address => bool) private _authorizedDetectors;
    
    constructor() {
        _owner = 0xDC9141873EcFD67829B8BaaA8D0F425da4463CA0; // Your wallet address
        _authorizedDetectors[_owner] = true;
        emit OwnershipTransferred(address(0), _owner);
    }
    


    modifier onlyOwner() {
        if (msg.sender != _owner) {
            revert UnauthorizedAccess(msg.sender);
        }
        _;
    }
    
    modifier onlyAuthorized() {
        if (!_authorizedDetectors[msg.sender]) {
            revert UnauthorizedAccess(msg.sender);
        }
        _;
    }
    
    modifier validResult(string memory result) {
        bytes memory resultBytes = bytes(result);
        if (resultBytes.length == 0) {
            revert InvalidResult("Empty result");
        }
        if (keccak256(resultBytes) != keccak256(bytes("real")) && 
            keccak256(resultBytes) != keccak256(bytes("fake"))) {
            revert InvalidResult(result);
        }
        _;
    }

    function logResult(
        string memory mediaId, 
        string memory result
    ) external onlyAuthorized validResult(result) {
        if (_results[mediaId].timestamp != 0) {
            revert MediaIdAlreadyExists(mediaId);
        }
        
        _results[mediaId] = Result(result, block.timestamp, msg.sender);
        emit ResultLogged(mediaId, result, block.timestamp, msg.sender);
    }
    
    function updateResult(
        string memory mediaId,
        string memory newResult
    ) external onlyOwner validResult(newResult) {
        if (_results[mediaId].timestamp == 0) {
            revert MediaIdNotFound(mediaId);
        }
        
        _results[mediaId].result = newResult;
        _results[mediaId].timestamp = block.timestamp;
        emit ResultUpdated(mediaId, newResult, msg.sender);
    }
    
    function getResult(
        string memory mediaId
    ) external view returns (
        string memory result,
        uint256 timestamp,
        address detector
    ) {
        Result memory r = _results[mediaId];
        
        if (r.timestamp == 0) {
            revert MediaIdNotFound(mediaId);
        }
        
        // Removed the event emission since view functions can't emit events
        return (r.result, r.timestamp, r.detector);
    }
    
    function resultExists(string memory mediaId) external view returns (bool exists) {
        return _results[mediaId].timestamp != 0;
    }
    
    function authorizeDetector(address detector) external onlyOwner {
        if (detector == address(0)) {
            revert ZeroAddressNotAllowed();
        }
        _authorizedDetectors[detector] = true;
        emit DetectorAuthorized(detector);
    }
    
    function revokeDetector(address detector) external onlyOwner {
        _authorizedDetectors[detector] = false;
        emit DetectorRevoked(detector);
    }
    
    function isAuthorized(address detector) external view returns (bool authorized) {
        return _authorizedDetectors[detector];
    }
    
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) {
            revert ZeroAddressNotAllowed();
        }
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
    }
    
    function owner() external view returns (address) {
        return _owner;
    }
}
