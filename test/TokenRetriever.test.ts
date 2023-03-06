import { expect } from 'chai'
import { deployContract } from './utilities'
import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IERC20, TokenRetriever } from '../types'

const BATCH_RELAYER = '0x419F7925b8C9e409B6Ee8792242556fa210A7A09'
const BEETS = '0xF24Bcf4d1e507740041C9cFd2DddB29585aDCe1e'

// run fork
// yarn hardhat node --fork https://rpc.ftm.tools/ --fork-block-number 57044536

describe('TokenRetriever', function () {
    let owner: SignerWithAddress
    let retriever: TokenRetriever

    before(async function () {
        const signers = await ethers.getSigners()
        owner = signers[0]
    })

    it('test forking', async () => {
        const relayer = await ethers.getContractAt('IBatchRelayer', BATCH_RELAYER)

        const vault = await relayer.getVault()
        console.log('vault', vault)
    })

    it('deploy retriever', async () => {
        retriever = (await deployContract('TokenRetriever', [BEETS])) as TokenRetriever
        expect(BEETS).to.be.equal(await retriever.asset())
    })

    it('retrieve beets', async () => {
        const beestContract = (await ethers.getContractAt('IERC20', BEETS)) as IERC20
        const beetsBalanceOnBatchRelayer = await beestContract.balanceOf(BATCH_RELAYER)
        console.log(`Beets on relayer before: ${beetsBalanceOnBatchRelayer.toString()}`)
        expect(beetsBalanceOnBatchRelayer.toString()).not.to.be.equal('0')
        const beetsBalanceOnDevBefore = await beestContract.balanceOf(owner.address)
        console.log(`Beets on dev before: ${beetsBalanceOnDevBefore.toString()}`)
        await retriever.retrieve(owner.address)
        const beetsBalanceOnDev = await beestContract.balanceOf(owner.address)
        const beetsBalanceOnRelayerAfter = await beestContract.balanceOf(BATCH_RELAYER)
        console.log(`Beets on relayer after: ${beetsBalanceOnRelayerAfter.toString()}`)
        console.log(`Beets on dev: ${beetsBalanceOnDev.toString()}`)
        expect(beetsBalanceOnRelayerAfter.toString()).to.be.equal('0')
        expect(beetsBalanceOnDev.sub(beetsBalanceOnDevBefore).toString()).to.be.equal(
            beetsBalanceOnBatchRelayer.toString(),
        )
    })
})
