import { expect } from 'chai'
import {
    advanceBlock,
    advanceToTime,
    bn,
    deployContract,
    deployERC20Mock,
    getLatestBlock,
    latest,
    setAutomineBlocks,
} from './utilities'
import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IERC20, TimeBasedMasterChefRewarder, TokenRetriever } from '../types'

const MASTERCHEF = '0x8166994d9ebBe5829EC86Bd81258149B87faCfd3'

// run fork
// yarn hardhat node --fork https://rpc.ftm.tools/ --fork-block-number 57044536

describe('MasterchefCheckpointer', function () {
    let owner: SignerWithAddress
    let checkpointer: TokenRetriever

    const allUsers = [
        '0x06ff56da1bb2fe0dbf3c30e362f7ea05d5168620',
        '0x103b1ef2a242c05ad32570c6f9a71a546bb51c4d',
        '0x12990834aa3c237a2ee7002c4a122ea14bc94904',
        '0x133c4979630d1c45051b1b875e319cf6fe479743',
        '0x1e050ca02787ab13d2006c9f06801789546a9eda',
        '0x1ec2d33c7d23e99b83524b4a013d0bd35e20a07c',
        '0x2067d095f4cacb434e921a2cf5b89a09dbf518a4',
        '0x2114471f619916a52e39dc08081cb9e650e80b22',
        '0x226b0f958850f8fb12176eb85212eea977683b27',
        '0x293233bbf144499ef02bdb96e8ec0ac0d6260473',
        '0x2a318be0876a44e95fb9433359e2487914e1b42d',
        '0x2df44f531f9b8cd82f181f7e3f3401e392f1b19e',
        '0x2f556083bd13f674c7a5838988ef73b79dd689cc',
        '0x357ae2fea8aeac0f55dea43fe70ce15f4af06c64',
        '0x3838c954d0629918578847378ee22e6778473239',
        '0x412aee8ebfa17dde82e25f4d8f0f06c9073e5833',
        '0x41a6ac7f4e4dbffeb934f95f1db58b68c76dc4df',
        '0x424d5011484dd4abf2e52a5406bf225b1f50023b',
        '0x4467bdd70a97ef05c5ae03ca8c34b3868df19a4c',
        '0x446de31ba31f3fce6d6c3970238a10d02bbf6cf2',
        '0x44791b9c211ede531d80c544d015ac904c5684f5',
        '0x44f4da18d1e9609e13b3d10cd091e3836c69bff2',
        '0x46fcb04b7cafef59d2ce09d79d32ad4a0afa9e61',
        '0x470e2c101884d0686327547a7b1b96a5c741f34e',
        '0x4ffd0a59a26cb2aa76d403215e4cc2845c053994',
        '0x507cc427c8fba38b81e891549189e6718862af45',
        '0x51f9fae0199f65445c9c3d2429c1a5672ce5b226',
        '0x571ebd4c979f1725593bfb129a24d595d6adfc23',
        '0x5920ca4a51d93052f111e90c387f70bcf723ea3f',
        '0x5a052a9928d100bb68e14ed2a8091c1a758e1bf0',
        '0x5d9ac7a6df81b63d61e58facf04c60881f59c1c3',
        '0x5eb70a5e6c8c8d7ca4e38b3de8755b9c5a493a6e',
        '0x60a299bc654ec399373fa377b482321a90220051',
        '0x63a3bb359ec36656b0d1c242099483110caac839',
        '0x65877be34c0c3c3a317d97028fd91bd261410026',
        '0x6c2693f5a936f37ed03cfa8465bf2d8beff19a0f',
        '0x6ca51640b905ba09b176829d20e74c76688f5e8d',
        '0x7278191cd7a2a060c59ee8b8fd11da288cc03deb',
        '0x74fc147dcacdf2680c3219c80191121f2ef2258b',
        '0x76c5480ed39e1494755aa49945b202caa553d7b9',
        '0x7c88c73f45338e7ee38b246082ab85297f5de5f1',
        '0x7d51598d425b68b41436c97c3029cbde4850dfa8',
        '0x7ece13f2fee7f2ff9cfb56b1f6d1ef2a787d68d7',
        '0x7f5362951c7ba111c5e196b7dc6c8f61b876e345',
        '0x800f91aa25b91ee3bbc1cce1dddff43cd2e62076',
        '0x801948874981eb75de34d53e7e35b58d44ac1a45',
        '0x80fe9e3dbbb75d44fce3e277ee73af1bd34b62ce',
        '0x85aa9b9a1346b398c8827c605cf4b12dda658c54',
        '0x8b78c25279649915b38f1ab3940902c06a928256',
        '0x8ccb2c0530f9e3d2dc8a08f96223f69d78df677a',
        '0x8f5d2d99f981456146a412e3e692e61249199e4e',
        '0x8ff8aba1c8bd3c607a650d15ff1e3662aac92b4b',
        '0x919a121c326b117b617dee801b85c008bdd8fa26',
        '0x91f4e48384f775b819c77c4901db6ca6e2e92b80',
        '0x991c4d7d1c194a6753799f788fa49218181ccffa',
        '0x99f06631425f01514e774bf3208909fdeb5305b3',
        '0xa380dace2095adc258d2be066e2a60a9dbacf7ad',
        '0xa3b926f6d2bb5507fe711847640ba2086cb11a75',
        '0xa54dbdbfa896ab581a231cc882a70d1479ec8195',
        '0xa9eaef87c01b4c46a691862c7ba94401394b8b9c',
        '0xaddadf3df10bebfff7201427d50cc0448e2e6f3a',
        '0xb241592366946fcfa1588d8a0e19edbb48a21167',
        '0xb40319006684704b5e8c5f32b3ea6fa34ff55ace',
        '0xb81b07beda149c6b0aee849d210abf2ee655e525',
        '0xbcf8c5f6ed6c679e6a5a858f807f0c15535fb16d',
        '0xc22fe1adc4f165fb87ab5e2de68c11cc2e6bb58d',
        '0xc32de03e195fa0e2e59338968c37d53b7a151c98',
        '0xc53ebcc199cc45f42d4232b6dd807df8282454ad',
        '0xca6ff42933c0c76e9ae059b495476fad3e366494',
        '0xcc7dd6d4d632c52694c574b79ad2a9131b9e0fd7',
        '0xce3ddf9436bfcc3d9bdb1810b88f07ee84da5616',
        '0xdca6143e849247df9d1a32264fe5108fe31ae878',
        '0xe3964b997f1c7e6dee6ef028d7d2e6bbd3532acc',
        '0xe45b0c5d1c5f2673d5ca8ddbc5c5cc8a1830f101',
        '0xe7d0464315faa9ffb8f2395f86e5ae02fbc146e6',
        '0xe80a0a301d4affc9527d9093c645c6920ffeae1d',
        '0xf07a9bb60f3811d2c919087499479305b2f4c451',
        '0xf46d3a64d546d9cec0883e5fbba04583363df24c',
        '0xf4b36bc19d94578de4c25f9013fd0c6fa5badb00',
        '0xf6d5bbf160cc356d93bb617ffa0e56cccdd390b4',
        '0xf93a7645758daa29ff90ad14b9e8841de4e5c405',
        '0xfa200fbb4b8040c2538f8ade814d7df41677d345',
        '0xfd119c2bb73acd9bd408856b53e51262ce8c56ba',
    ]

    before(async function () {
        const signers = await ethers.getSigners()
        owner = signers[0]
    })

    it('test forking', async () => {
        const masterchef = await ethers.getContractAt('BeethovenxMasterChef', MASTERCHEF)

        const length = await masterchef.poolLength()
        console.log('poolLength', length)
    })

    it('deploy checkpointer', async () => {
        checkpointer = (await deployContract('MasterchefCheckpointer', [MASTERCHEF])) as TokenRetriever
        expect(MASTERCHEF).to.be.equal(await checkpointer.masterchef())
    })

    it('checkpoint 1 user', async () => {
        await checkpointer.checkpointUsers(129, [allUsers[0]])
    })

    it('checkpoint all users', async () => {
        console.log(allUsers.length)
        const txn = await checkpointer.checkpointUsers(129, allUsers)
    })
})
