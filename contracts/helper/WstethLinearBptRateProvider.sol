// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.7;

interface IRateProvider {
    function getRate() external view returns (uint256 _rate);
}

contract WstethLinearBptRateProvider is IRateProvider {
    address public immutable wstEthRateProvider;
    address public immutable linearBptRateProvider;

    constructor(address _wstEthRateProvider, address _linearBptRateProvider) {
        wstEthRateProvider = _wstEthRateProvider;
        linearBptRateProvider = _linearBptRateProvider;
    }

    function getRate() external view override returns (uint256 _rate) {
        return (IRateProvider(wstEthRateProvider).getRate() * IRateProvider(linearBptRateProvider).getRate()) / 1e18;
    }
}
