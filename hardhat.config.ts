import 'dotenv/config'
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-etherscan'
import '@nomiclabs/hardhat-solhint'
import '@nomiclabs/hardhat-vyper'
import '@nomiclabs/hardhat-waffle'
import '@tenderly/hardhat-tenderly'
import 'hardhat-abi-exporter'
import 'hardhat-deploy'
import 'hardhat-deploy-ethers'
import 'hardhat-gas-reporter'
import 'hardhat-spdx-license-identifier'
import 'hardhat-typechain'
import 'hardhat-watcher'
import 'solidity-coverage'

import { HardhatUserConfig } from 'hardhat/types'
import { removeConsoleLog } from 'hardhat-preprocessor'

const accounts = [`0x${process.env.DEPLOYER!}`]

const config: HardhatUserConfig = {
    abiExporter: {
        path: './abi',
        clear: false,
        flat: true,
    },
    defaultNetwork: 'hardhat',
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY,
    },
    gasReporter: {
        coinmarketcap: process.env.COINMARKETCAP_API_KEY,
        currency: 'USD',
        enabled: process.env.REPORT_GAS === 'true',
        excludeContracts: ['contracts/mocks/', 'contracts/libraries/'],
    },
    mocha: {
        timeout: 20000,
    },
    namedAccounts: {
        deployer: 0,
    },
    networks: {
        // hardhat: {
        //   accounts: [
        //     {
        //       privateKey: `0x${process.env.DEPLOYER!}`,
        //       balance: "100000000000000000000000",
        //     },
        //   ],
        //   forking: {
        //     url: "https://rpc.ftm.tools/",
        //     blockNumber: 47870816,
        //   },
        // },
        localhost: {
            live: false,
            saveDeployments: true,
            tags: ['local'],
        },
        rinkeby: {
            url: `https://rinkeby.infura.io/v3/${process.env.INFURA_API_KEY}`,
            accounts,
            chainId: 4,
            live: true,
            saveDeployments: true,
        },
        fantom: {
            url: 'https://rpc.ftm.tools/',
            accounts,
            chainId: 250,
            live: true,
            saveDeployments: true,
            // gasMultiplier: 30,
        },
        goerli: {
            url: `https://eth-goerli.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`,
            chainId: 5,
            accounts,
        },
        optimism: {
            url: 'https://mainnet.optimism.io',
            accounts: accounts,
            chainId: 10,
        },
        gnosis: {
            url: 'https://rpc.gnosischain.com',
            accounts: accounts,
            chainId: 100,
        },
        // "fantom-testnet": {
        //   url: "https://rpc.testnet.fantom.network",
        //   accounts,
        //   chainId: 4002,
        //   live: true,
        //   saveDeployments: true,
        //   tags: ["staging"],
        //   gasMultiplier: 2,
        // },
    },
    paths: {
        artifacts: 'artifacts',
        cache: 'cache',
        deploy: 'deploy',
        deployments: 'deployments',
        imports: 'imports',
        sources: 'contracts',
        tests: 'test',
    },
    preprocess: {
        eachLine: removeConsoleLog((bre) => bre.network.name !== 'hardhat' && bre.network.name !== 'localhost'),
    },
    solidity: {
        compilers: [
            {
                version: '0.8.7',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
            {
                version: '0.7.0',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
            {
                version: '0.8.15',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                    // viaIR: true,
                },
            },
            {
                version: '0.8.17',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                    // viaIR: true,
                },
            },
        ],
    },
    spdxLicenseIdentifier: {
        overwrite: false,
        runOnCompile: true,
    },
    tenderly: {
        project: process.env.TENDERLY_PROJECT!,
        username: process.env.TENDERLY_USERNAME!,
    },
    typechain: {
        outDir: 'types',
        target: 'ethers-v5',
    },
    watcher: {
        compile: {
            tasks: ['compile'],
            files: ['./contracts'],
            verbose: true,
        },
    },
    vyper: {
        version: '0.3.3',
    },
}

export default config
