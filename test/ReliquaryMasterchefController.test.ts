import { expect } from 'chai'
import { deployContract } from './utilities'
import { ethers, network } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IERC20, ReliquaryMasterchefController, BeethovenxMasterChef, IReliquary } from '../types'
import { BigNumber } from 'ethers'
import { mine, time } from "@nomicfoundation/hardhat-network-helpers"

const MASTERCHEF = '0x8166994d9ebBe5829EC86Bd81258149B87faCfd3';
const RELIQUARY = '0x1ed6411670c709F4e163854654BD52c74E66D7eC';

const RELIC_HOLDER_1 = '0x43C4fF14DAe2Fbb389Dd94498C3D610A0c69a89d';
const RELIC_HOLDER_2 = '0x911B1ecef200fE24E4ea9B54B9D87C3dfbfDB5Db';
const RELIC_HOLDER_3 = '0xbf21Ba013A41b443b7b21eaAbBB647ceC360fa68';
const HOLDER_WITH_3_RELICS = '0x00a01bc13a1ddf4a4af6852baee66b76a0316cbc';

const ONE = BigNumber.from('1000000000000000000');

// run fork
// yarn hardhat node --fork https://rpc.ftm.tools/ --fork-block-number 58192000

describe('ReliquaryMasterchefController', function () {
    let owner: SignerWithAddress;
    let controller: ReliquaryMasterchefController;
    let masterchef: BeethovenxMasterChef;
    let reliquary: IReliquary;
    let signer1: SignerWithAddress;
    let relicId1: string;
    let votingPower1: BigNumber;
    let signer2: SignerWithAddress;
    let relicId2: string;
    let votingPower2: BigNumber;
    let relicId3: string;
    let VOTING_CLOSES_SECONDS_BEFORE_NEXT_EPOCH: number;
    let nextEpoch: number;

    beforeEach(async function () {
        const signers = await ethers.getSigners();
        owner = signers[0];

        reliquary = (await ethers.getContractAt('IReliquary', RELIQUARY)) as IReliquary;
        masterchef = (await ethers.getContractAt('BeethovenxMasterChef', MASTERCHEF)) as BeethovenxMasterChef;
        controller = (await deployContract('ReliquaryMasterchefController', [MASTERCHEF, RELIQUARY, 70, 30])) as ReliquaryMasterchefController;

        await controller.grantRole(await controller.OPERATOR(), owner.address);
        await controller.grantRole(await controller.COMMITTEE_MEMBER(), owner.address);
    });

    beforeEach(async () => {
        await network.provider.request({ method: "hardhat_impersonateAccount", params: [RELIC_HOLDER_1] });
        signer1 = await ethers.getSigner(RELIC_HOLDER_1);

        let response = await reliquary.relicPositionsOfOwner(RELIC_HOLDER_1);
        let info = response.positionInfos[0];
        relicId1 = response.relicIds[0].toString();
        
        let levelInfo = await reliquary.getLevelInfo(info.poolId);
        let maxLevelMultiplier = levelInfo.multipliers[levelInfo.multipliers.length - 1];
        let currentLevelMultiplier = levelInfo.multipliers[info.level.toNumber()];

        votingPower1 = info.amount.mul(ONE).mul(currentLevelMultiplier).div(maxLevelMultiplier).div(ONE);

        await network.provider.request({ method: "hardhat_impersonateAccount", params: [HOLDER_WITH_3_RELICS] });
        signer2 = await ethers.getSigner(HOLDER_WITH_3_RELICS);

        response = await reliquary.relicPositionsOfOwner(HOLDER_WITH_3_RELICS);
        info = response.positionInfos[0];
        relicId2 = response.relicIds[0].toString();
        relicId3 = response.relicIds[1].toString();
        
        levelInfo = await reliquary.getLevelInfo(info.poolId);
        maxLevelMultiplier = levelInfo.multipliers[levelInfo.multipliers.length - 1];
        currentLevelMultiplier = levelInfo.multipliers[info.level.toNumber()];

        votingPower2 = info.amount.mul(ONE).mul(currentLevelMultiplier).div(maxLevelMultiplier).div(ONE);
    
        nextEpoch = (await controller.getNextEpochTimestamp()).toNumber();
        VOTING_CLOSES_SECONDS_BEFORE_NEXT_EPOCH = (await controller.VOTING_CLOSES_SECONDS_BEFORE_NEXT_EPOCH()).toNumber();
    });

    describe('farms', () => {
        it('can sync farms', async () => {
            await controller.syncFarms(5, 0);
        
            const farm = await controller.farms(4);
            const { statuses } = await controller.getFarmStatuses(4);

            expect(farm.farmId).to.eq(4);
            expect(farm.token).to.eq('0xA07De66AeF84e2c01D88a48D57D1463377Ee602b');
            expect(farm.poolId).to.eq('0xa07de66aef84e2c01d88a48d57d1463377ee602b000200000000000000000002');
            expect(statuses[0]).to.eq(0);
        });
    
        it('can sync farms with an initial status of enabled', async () => {
            await controller.syncFarms(5, 1);
        
            const { statuses } = await controller.getFarmStatuses(4);
    
            expect(statuses[0]).to.eq(1);
        });
    
        it('reverts when syncing from an account that is not the operator', async () => {
            await network.provider.request({ method: "hardhat_impersonateAccount", params: [RELIC_HOLDER_1] });
            const signer = await ethers.getSigner(RELIC_HOLDER_1);
    
            await expect(controller.connect(signer).syncFarms(5, 0)).to.revertedWith('AccessControl');
        });

        it('can enable a farm', async () => {
            await controller.syncFarms(1, 0);

            const before = await controller.getFarmStatuses(0);
            expect(before.statuses[0]).to.eq(0);

            await controller.enableFarm(0);

            const after = await controller.getFarmStatuses(0);
            expect(after.statuses[0]).to.eq(1);
        });

        it('can disable a farm', async () => {
            await controller.syncFarms(1, 1);

            const before = await controller.getFarmStatuses(0);
            expect(before.statuses[0]).to.eq(1);

            await controller.disableFarm(0);

            const after = await controller.getFarmStatuses(0);
            expect(after.statuses[0]).to.eq(0);
        });

        it('changing status during a registered epoch does not create a new status entry', async () => {
            await controller.syncFarms(1, 1);

            await controller.disableFarm(0);

            const { statuses } = await controller.getFarmStatuses(0);
            expect(statuses.length).to.eq(1);
        });

        it('reverts when enabling an enabled farm', async () => {
            await controller.syncFarms(1, 1);

            await expect(controller.enableFarm(0)).to.revertedWith('FarmIsEnabled');
        });

        it('reverts when disabling a disabled farm', async () => {
            await controller.syncFarms(1, 0);

            await expect(controller.disableFarm(0)).to.revertedWith('FarmIsDisabled');
        });

        it('reverts when enabling a farm that does not exist', async () => {
            await controller.syncFarms(1, 0);

            await expect(controller.enableFarm(10)).to.revertedWith('FarmDoesNotExist');
        });

        it('reverts when operating from an account that is not the operator', async () => {
            await controller.syncFarms(5, 0);
            await controller.enableFarm(0);
            
            await network.provider.request({ method: "hardhat_impersonateAccount", params: [RELIC_HOLDER_1] });
            const signer = await ethers.getSigner(RELIC_HOLDER_1);
    
            await expect(controller.connect(signer).disableFarm(0)).to.revertedWith('AccessControl');
            await expect(controller.connect(signer).enableFarm(1)).to.revertedWith('AccessControl');
        });
    });

    describe('voting', () => {
        beforeEach(async () => {
            await controller.syncFarms(10, 1);
        });

        it('can set votes for a relic', async () => {
            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [
                    {farmId: 0, amount: votingPower1.div('2')},
                    {farmId: 2, amount: votingPower1.div('2')}
                ]
            );

            const votes = await controller.getRelicVotesForEpoch(relicId1, nextEpoch);

            expect(votes[0]).to.eq(votingPower1.div('2'));
            expect(votes[2]).to.eq(votingPower1.div('2'));
            expect(votes[1]).to.eq('0');
        });

        it('can change votes', async () => {
            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [
                    {farmId: 0, amount: votingPower1.div('2')},
                    {farmId: 1, amount: votingPower1.div('2')}
                ]
            );

            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [{farmId: 2, amount: votingPower1.div('2')}]
            );

            const votes = await controller.getRelicVotesForEpoch(relicId1, nextEpoch);

            expect(votes[0]).to.eq('0');
            expect(votes[1]).to.eq('0');
            expect(votes[2]).to.eq(votingPower1.div('2'));
        });

        it('should revert if votes contain the same farm id twice', async () => {
            await expect(controller.connect(signer1).setVotesForRelic(
                relicId1,
                [
                    {farmId: 0, amount: votingPower1.div('2')},
                    {farmId: 0, amount: votingPower1.div('2')}
                ]
            )).to.revertedWith('NoDuplicateVotes');
        });

        it('should revert if total amount exceeds voting power', async () => {
            await expect(controller.connect(signer1).setVotesForRelic(
                relicId1,
                [
                    {farmId: 0, amount: votingPower1.div('2')},
                    {farmId: 1, amount: votingPower1.div('2')},
                    {farmId: 2, amount: 1},
                ]
            )).to.revertedWith('AmountExceedsVotingPower');
        });

        it('should revert when voting for a disabled farm', async () => {
            await controller.disableFarm(0);

            await expect(controller.connect(signer1).setVotesForRelic(
                relicId1,
                [{farmId: 0, amount: 1}]
            )).to.revertedWith('FarmIsDisabled');
        });

        it('should revert when voting with a relic you do not own', async () => {
            await expect(controller.connect(signer2).setVotesForRelic(
                relicId1,
                [{farmId: 0, amount: 1}]
            )).to.revertedWith('NotApprovedOrOwner');
        });

        it('can set votes for two relics from different owners', async () => {
            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [
                    {farmId: 0, amount: votingPower1.div('2')},
                    {farmId: 2, amount: votingPower1.div('2')}
                ]
            );

            await controller.connect(signer2).setVotesForRelic(
                relicId2,
                [
                    {farmId: 0, amount: votingPower2.div('2')},
                    {farmId: 2, amount: votingPower2.div('2')}
                ]
            );

            const votes1 = await controller.getRelicVotesForEpoch(relicId1, nextEpoch);
            const votes2 = await controller.getRelicVotesForEpoch(relicId2, nextEpoch);
            const epochVotes = await controller.getEpochVotes(nextEpoch);
            const totalVotes = await controller.getTotalVotesForEpoch(nextEpoch);

            expect(votes1[0]).to.eq(votingPower1.div('2'));
            expect(votes1[2]).to.eq(votingPower1.div('2'));
            expect(votes2[0]).to.eq(votingPower2.div('2'));
            expect(votes2[2]).to.eq(votingPower2.div('2'));

            expect(epochVotes[0]).to.eq(votingPower1.div('2').add(votingPower2.div('2')));
            expect(epochVotes[2]).to.eq(votingPower1.div('2').add(votingPower2.div('2')));

            expect(totalVotes).to.eq(votingPower1.add(votingPower2));
        });

        it('can set vote with multiple relics at once', async () => {
            await controller.connect(signer2).setVotesForRelics(
                [relicId2, relicId3],
                [
                    [{farmId: 0, amount: votingPower2.div('2')}],
                    [{farmId: 1, amount: 1}],
                ]
            );

            const votes2 = await controller.getRelicVotesForEpoch(relicId2, nextEpoch);
            const votes3 = await controller.getRelicVotesForEpoch(relicId3, nextEpoch);
            const epochVotes = await controller.getEpochVotes(nextEpoch);
            const totalVotes = await controller.getTotalVotesForEpoch(nextEpoch);

            expect(votes2[0]).to.eq(votingPower2.div('2'));
            expect(votes3[1]).to.eq(1);

            expect(totalVotes).to.eq(votingPower2.div('2').add(1));
        });

        it('can change votes after multiple votes and still have the correct amounts', async () => {
            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [
                    {farmId: 0, amount: votingPower1.div('2')},
                    {farmId: 2, amount: votingPower1.div('2')}
                ]
            );

            await controller.connect(signer2).setVotesForRelic(
                relicId2,
                [
                    {farmId: 0, amount: votingPower2.div('2')},
                    {farmId: 2, amount: votingPower2.div('2')}
                ]
            );

            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [{farmId: 1, amount: votingPower1}]
            );

            const epochVotes = await controller.getEpochVotes(nextEpoch);
            const totalVotes = await controller.getTotalVotesForEpoch(nextEpoch);


            expect(epochVotes[0]).to.eq(votingPower2.div('2'));
            expect(epochVotes[1]).to.eq(votingPower1);
            expect(epochVotes[2]).to.eq(votingPower2.div('2'));

            expect(totalVotes).to.eq(votingPower1.add(votingPower2));
        });

        it('should revert when voting with relics you do not own', async () => {
            await expect(controller.connect(signer1).setVotesForRelics(
                [relicId2, relicId3],
                [
                    [{farmId: 0, amount: votingPower2.div('2')}],
                    [{farmId: 1, amount: 1}],
                ]
            )).to.revertedWith('NotApprovedOrOwner');
        });
    });

    describe('allocation points', () => {
        it('can set maBeets allocation points', async () => {
            await controller.setMaBeetsAllocPoints(1);
            let maBeetsAllocPoints = await controller.maBeetsAllocPoints();

            expect(maBeetsAllocPoints).to.eq(1);

            await controller.setMaBeetsAllocPoints(2);
            maBeetsAllocPoints = await controller.maBeetsAllocPoints();

            expect(maBeetsAllocPoints).to.eq(2);
        });

        it('can set committee allocation points', async () => {
            await controller.setCommitteeAllocPoints(1);
            let committeeAllocPoints = await controller.committeeAllocPoints();

            expect(committeeAllocPoints).to.eq(1);

            await controller.setCommitteeAllocPoints(2);
            committeeAllocPoints = await controller.committeeAllocPoints();

            expect(committeeAllocPoints).to.eq(2);
        });

        it('reverts when setting mabeets alloc points with non operator acount', async () => {
            await expect(controller.connect(signer1).setMaBeetsAllocPoints(1)).to.revertedWith('AccessControl');
        });

        it('reverts when setting committee alloc points with non operator acount', async () => {
            await expect(controller.connect(signer1).setCommitteeAllocPoints(1)).to.revertedWith('AccessControl');
        });
    });

    describe('incentives', () => {
        it('can whitelist token', async () => {
        });

        it('cannot whitelist the same token twice', async () => {
        });

        it('only allows operators to whitelist tokens', async () => {
        });

        it('whitelisted tokens are added in order', async () => {
        });
    });
})
