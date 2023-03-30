import { expect } from 'chai'
import { deployContract } from './utilities'
import { ethers, network } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { IERC20, ReliquaryMasterchefController, BeethovenxMasterChef, IReliquary } from '../types'
import { BigNumber, Contract, BigNumberish } from 'ethers'
import { mine, time } from "@nomicfoundation/hardhat-network-helpers"
import { advanceTime, advanceToTime, advanceBlock, advanceTimeAndBlock } from './utilities/time';

const MASTERCHEF = '0x8166994d9ebBe5829EC86Bd81258149B87faCfd3';
const RELIQUARY = '0x1ed6411670c709F4e163854654BD52c74E66D7eC';

const RELIC_HOLDER_1 = '0x2f07C8De8b633a7B4278B28C09a654295D8eEefb';
const RELIC_HOLDER_2 = '0x911B1ecef200fE24E4ea9B54B9D87C3dfbfDB5Db';
const RELIC_HOLDER_3 = '0xbf21Ba013A41b443b7b21eaAbBB647ceC360fa68';
const HOLDER_WITH_3_RELICS = '0x00a01bc13a1ddf4a4af6852baee66b76a0316cbc';

const USDC = '0x04068da6c83afcfa0e13ba15a6696662335d5b75';
const WFTM = '0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83';

const ONE = BigNumber.from('1000000000000000000');

const MABEETS_ALLOC_POINTS = 70;
const MABEETS_POOL_ID = 2;

// run fork
// yarn hardhat node --fork https://rpc.ftm.tools/ --fork-block-number 58192000

const WEEK_IN_SECONDS = 604800;

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
    let EPOCH_DURATION_IN_SECONDS: number;
    let nextEpoch: number;

    beforeEach(async function () {
        const signers = await ethers.getSigners();
        owner = signers[0];

        reliquary = (await ethers.getContractAt('IReliquary', RELIQUARY)) as IReliquary;
        masterchef = (await ethers.getContractAt('BeethovenxMasterChef', MASTERCHEF)) as BeethovenxMasterChef;
        controller = (await deployContract('ReliquaryMasterchefController', [MASTERCHEF, RELIQUARY, MABEETS_POOL_ID, MABEETS_ALLOC_POINTS, 30])) as ReliquaryMasterchefController;

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
        EPOCH_DURATION_IN_SECONDS = (await controller.EPOCH_DURATION_IN_SECONDS()).toNumber();
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
                [
                    {farmId: 0, amount: 0},
                    {farmId: 1, amount: 0},
                    {farmId: 2, amount: votingPower1.div('2')}
                ]
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
                [
                    {farmId: 0, amount: 0},
                    {farmId: 1, amount: votingPower1},
                    {farmId: 2, amount: 0},
                ]
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

        it('can vote several times as long as the total votes do not exceed total voting power', async () => {
            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [{farmId: 0, amount: votingPower1.div('8')}]
            );

            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [{farmId: 1, amount: votingPower1.div('8')}]
            );

            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [{farmId: 2, amount: votingPower1.div('8')}]
            );

            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [{farmId: 3, amount: votingPower1.div('8')}]
            );

            const votes = await controller.getRelicVotesForEpoch(relicId1, nextEpoch);

            expect(votes[0]).to.eq(votingPower1.div('8'));
            expect(votes[1]).to.eq(votingPower1.div('8'));
            expect(votes[2]).to.eq(votingPower1.div('8'));
            expect(votes[3]).to.eq(votingPower1.div('8'));
        });

        it('reverts when voting several times exceeds voting power', async () => {
            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [{farmId: 0, amount: votingPower1.div('2')}]
            );

            await expect(controller.connect(signer1).setVotesForRelic(
                relicId1,
                [{farmId: 1, amount: votingPower1}]
            )).to.revertedWith('AmountExceedsVotingPower');
        });
    });

    describe('allocation points', () => {
        beforeEach(async () => {
            await controller.syncFarms(10, 1);
        });

        it('can set maBeets allocation points', async () => {
            await controller.setMaBeetsAllocPoints(1);
            let maBeetsAllocPoints = await controller.getMaBeetsAllocPointsForEpoch(nextEpoch);

            expect(maBeetsAllocPoints).to.eq(1000);

            await controller.setMaBeetsAllocPoints(2);
            maBeetsAllocPoints = await controller.getMaBeetsAllocPointsForEpoch(nextEpoch);

            expect(maBeetsAllocPoints).to.eq(2000);
        });

        it('can set committee allocation points', async () => {
            await controller.setCommitteeAllocPoints(1);
            let committeeAllocPoints = await controller.getComitteeAllocPointsForEpoch(nextEpoch);

            expect(committeeAllocPoints).to.eq(1000);

            await controller.setCommitteeAllocPoints(2);
            committeeAllocPoints = await controller.getComitteeAllocPointsForEpoch(nextEpoch);

            expect(committeeAllocPoints).to.eq(2000);
        });

        it('reverts when setting mabeets alloc points with non operator acount', async () => {
            await expect(controller.connect(signer1).setMaBeetsAllocPoints(1)).to.revertedWith('AccessControl');
        });

        it('reverts when setting committee alloc points with non operator acount', async () => {
            await expect(controller.connect(signer1).setCommitteeAllocPoints(1)).to.revertedWith('AccessControl');
        });

        it('returns the correct number of allocation points', async () => {
            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [
                    {farmId: 0, amount: votingPower1.div('2')},
                    {farmId: 2, amount: votingPower1.div('2')}
                ]
            );

            const allocations = await controller.getMaBeetsFarmAllocationsForEpoch(nextEpoch);

            expect(allocations[0]).to.eq('35000');
            expect(allocations[2]).to.eq('35000');
        });

        it('returns the correct number of allocation points when numbers are not whole', async () => {
            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [
                    {farmId: 0, amount: votingPower1.div('4')},
                    {farmId: 1, amount: votingPower1.div('4')},
                    {farmId: 2, amount: votingPower1.div('4')},
                    {farmId: 3, amount: votingPower1.div('4')}
                ]
            );

            const allocations = await controller.getMaBeetsFarmAllocationsForEpoch(nextEpoch);

            expect(allocations[0]).to.eq('17500');
            expect(allocations[1]).to.eq('17500');
            expect(allocations[2]).to.eq('17500');
            expect(allocations[3]).to.eq('17500');
        });

        it('returns the correct number of allocation points when numbers are not whole 2', async () => {
            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [
                    {farmId: 0, amount: votingPower1.div('7')},
                    {farmId: 1, amount: votingPower1.div('7')},
                    {farmId: 2, amount: votingPower1.div('3')},
                ]
            );

            const allocations = await controller.getMaBeetsFarmAllocationsForEpoch(nextEpoch);

            expect(allocations[0]).to.eq('16153');
            expect(allocations[1]).to.eq('16153');
            expect(allocations[2]).to.eq('37692');
        });

        it('can set committee allocation points', async () => {
            await controller.setCommitteeFarmAllocationsForEpoch([
                {farmId: 0, allocPoints: 10000},
                {farmId: 1, allocPoints: 10000},
                {farmId: 2, allocPoints: 10000},
            ]);

            const allocations = await controller.getCommitteeFarmAllocationsForEpoch(nextEpoch);

            expect(allocations[0]).to.eq('10000');
            expect(allocations[1]).to.eq('10000');
            expect(allocations[2]).to.eq('10000');
        });

        /* it('reverts when no committee allocation provided for epoch', async () => {
            await expect(controller.getCommitteeAllocationsForEpoch(nextEpoch)).to.revertedWith('NoCommitteeAllocationForEpoch');
        }); */

        it('reverts when provided duplicate committee allocations', async () => {
            await expect(controller.setCommitteeFarmAllocationsForEpoch([
                {farmId: 0, allocPoints: 10},
                {farmId: 0, allocPoints: 10},
            ])).to.revertedWith('NoDuplicateAllocations');
        });

        it('reverts when provided more alloc points than controlled', async () => {
            await expect(controller.setCommitteeFarmAllocationsForEpoch([
                {farmId: 0, allocPoints: 10000},
                {farmId: 1, allocPoints: 10000},
                {farmId: 2, allocPoints: 10000},
                {farmId: 3, allocPoints: 10000},
            ])).to.revertedWith('CommitteeAllocationGreaterThanControlled');
        });

        it('returns the correct number of total allocation points', async () => {
            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [
                    {farmId: 0, amount: votingPower1.div('2')},
                    {farmId: 2, amount: votingPower1.div('2')}
                ]
            );

            await controller.setCommitteeFarmAllocationsForEpoch([
                {farmId: 0, allocPoints: 10000},
                {farmId: 1, allocPoints: 10000},
                {farmId: 2, allocPoints: 10000},
            ]);

            const allocations = await controller.getFarmAllocationsForEpoch(nextEpoch);

            expect(allocations[0]).to.eq('45000');
            expect(allocations[1]).to.eq('10000');
            expect(allocations[2]).to.eq('45000');
        });

        it('returns the correct number of allocation points when a farm is capped', async () => {
            await controller.setMaBeetsAllocPointCapsForEpoch([
                {farmId: 0, allocPoints: 2000},
                {farmId: 1, allocPoints: 3500}
            ]);

            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [
                    {farmId: 0, amount: votingPower1.div('4')},
                    {farmId: 1, amount: votingPower1.div('4')},
                    {farmId: 2, amount: votingPower1.div('4')},
                    {farmId: 3, amount: votingPower1.div('4')}
                ]
            );

            const allocations = await controller.getMaBeetsFarmAllocationsForEpoch(nextEpoch);

            expect(allocations[0]).to.eq('2000');
            expect(allocations[1]).to.eq('3500');
            expect(allocations[2]).to.eq('32250');
            expect(allocations[3]).to.eq('32250');
        });
    });

    describe('incentives', () => {
        beforeEach(async () => {
            await controller.syncFarms(10, 1);
        });

        it('can whitelist token', async () => {
            await controller.whiteListIncentiveToken(USDC);

            const token = await controller.getWhiteListedIncentiveToken(0);
            

            expect(token.toLowerCase()).to.eq(USDC.toLowerCase());
        });

        it('cannot whitelist the same token twice', async () => {
            await controller.whiteListIncentiveToken(USDC);

            await expect(controller.whiteListIncentiveToken(USDC)).to.revertedWith('IncentiveTokenAlreadyWhiteListed');
        });

        it('only allows operators to whitelist tokens', async () => {
            await expect(controller.connect(signer1).whiteListIncentiveToken(USDC)).to.revertedWith('AccessControl');
        });

        it('whitelisted tokens are added in order', async () => {
            await controller.whiteListIncentiveToken(WFTM);
            await controller.whiteListIncentiveToken(USDC);


            const token1 = await controller.getWhiteListedIncentiveToken(0);
            const token2 = await controller.getWhiteListedIncentiveToken(1);

            expect(token1.toLowerCase()).to.eq(WFTM.toLowerCase());
            expect(token2.toLowerCase()).to.eq(USDC.toLowerCase());
        });

        it('can deposit whitelisted tokens', async () => {
            await controller.whiteListIncentiveToken(WFTM);
            await controller.whiteListIncentiveToken(USDC);

            const wftm = (await ethers.getContractAt('IERC20', WFTM)) as IERC20;
            await wftm.approve(controller.address, ONE);

            const usdc = (await ethers.getContractAt('IERC20', USDC)) as IERC20;
            await usdc.approve(controller.address, 1e6);

            const balanceBefore = await wftm.balanceOf(owner.address);
            const usdcBalanceBefore = await usdc.balanceOf(owner.address);

            await controller.depositIncentiveForFarm(0, WFTM, ONE);
            await controller.depositIncentiveForFarm(0, USDC, 1e6);

            const balanceAfter = await wftm.balanceOf(owner.address);
            const usdcBalanceAfter = await usdc.balanceOf(owner.address);
            const controllerWftmBalance = await wftm.balanceOf(controller.address);
            const controllerUsdcBalance = await usdc.balanceOf(controller.address);

            const incentive = await controller.getIncentiveAmountForEpoch(0, nextEpoch, WFTM);
            const usdcIncentive = await controller.getIncentiveAmountForEpoch(0, nextEpoch, USDC);
            const incentives = await controller.getFarmIncentivesForEpoch(0, nextEpoch);


            expect(balanceBefore).to.eq(balanceAfter.add(ONE));
            expect(usdcBalanceBefore).to.eq(usdcBalanceAfter.add(1e6));
            expect(controllerWftmBalance).to.eq(ONE);
            expect(controllerUsdcBalance).to.eq(1e6);
            expect(incentive).to.eq(ONE);
            expect(usdcIncentive).to.eq(1e6)
            expect(incentives[0].token.toLowerCase()).to.eq(WFTM.toLowerCase());
            expect(incentives[0].amount).to.eq(ONE);
            expect(incentives[1].token.toLowerCase()).to.eq(USDC.toLowerCase());
            expect(incentives[1].amount).to.eq(1e6);            
        });
    });

    describe('time based', () => {
        beforeEach(async () => {
            await controller.syncFarms(10, 1);
        });

        it('has increased voting power after leveling up', async () => {
            const votingPowerBefore = await controller.getRelicVotingPower(relicId1);

            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [{farmId: 0, amount: votingPowerBefore}]
            );

            const totalVotesBefore = await controller.getTotalVotesForEpoch(nextEpoch);

            await advanceTimeAndBlock(WEEK_IN_SECONDS)

            const newEpoch = (await controller.getNextEpochTimestamp()).toNumber();
            await reliquary.updatePosition(relicId1);

            const votingPowerAfter = await controller.getRelicVotingPower(relicId1);

            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [{farmId: 0, amount: votingPowerAfter}]
            );

            const totalVotesAfter = await controller.getTotalVotesForEpoch(newEpoch);

            expect(votingPowerAfter.gt(votingPowerBefore)).to.eq(true);
            expectApproxEq(totalVotesBefore, votingPowerBefore);
            expectApproxEq(totalVotesAfter, votingPowerAfter);
        });

        it('should assign votes to expected epoch', async () => {
            const epoch = (await controller.getNextEpochTimestamp()).toNumber();
            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [{farmId: 0, amount: votingPower1}]
            );

            const totalVotes = await controller.getTotalVotesForEpoch(epoch);

            expect(totalVotes).to.eq(votingPower1);

            await advanceTimeAndBlock(EPOCH_DURATION_IN_SECONDS);

            const newEpoch = (await controller.getNextEpochTimestamp()).toNumber();
            await controller.connect(signer2).setVotesForRelic(
                relicId2,
                [{farmId: 0, amount: votingPower2}]
            );

            const totalVotesNewEpoch = await controller.getTotalVotesForEpoch(newEpoch);

            expect(totalVotesNewEpoch).to.eq(votingPower2);
        });

        it('can claim incentives after epoch change', async () => {
            const epoch = (await controller.getNextEpochTimestamp()).toNumber();
            await controller.whiteListIncentiveToken(WFTM);

            const wftm = (await ethers.getContractAt('IERC20', WFTM)) as IERC20;
            await wftm.approve(controller.address, ONE);

            await controller.depositIncentiveForFarm(0, WFTM, ONE);

            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [{farmId: 0, amount: votingPower1}]
            );

            await expect(
                controller.connect(signer1).claimIncentivesForFarm(relicId1, 0, epoch, WFTM, signer1.address)
            ).to.revertedWith('IncentivesForEpochNotYetClaimable');

            await advanceTimeAndBlock(EPOCH_DURATION_IN_SECONDS);

            const balanceBefore = await wftm.balanceOf(signer1.address);
            await controller.connect(signer1).claimIncentivesForFarm(relicId1, 0, epoch, WFTM, signer1.address);
            const balanceAfter = await wftm.balanceOf(signer1.address);
            
            expect(balanceAfter).to.eq(balanceBefore.add(ONE));
        });

        it('splits incentives across multiple voters', async () => {
            const epoch = (await controller.getNextEpochTimestamp()).toNumber();
            await controller.whiteListIncentiveToken(WFTM);

            const wftm = (await ethers.getContractAt('IERC20', WFTM)) as IERC20;
            await wftm.approve(controller.address, ONE);

            await controller.depositIncentiveForFarm(0, WFTM, ONE);

            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [{farmId: 0, amount: votingPower1}]
            );

            await controller.connect(signer2).setVotesForRelic(
                relicId2,
                [{farmId: 0, amount: votingPower2}]
            );

            await advanceTimeAndBlock(EPOCH_DURATION_IN_SECONDS);

            const balanceBefore1 = await wftm.balanceOf(signer1.address);
            await controller.connect(signer1).claimIncentivesForFarm(relicId1, 0, epoch, WFTM, signer1.address);
            const balanceAfter1 = await wftm.balanceOf(signer1.address);
            const share1 = votingPower1.mul(ONE).div(votingPower1.add(votingPower2));

            const balanceBefore2 = await wftm.balanceOf(signer2.address);
            await controller.connect(signer2).claimIncentivesForFarm(relicId2, 0, epoch, WFTM, signer2.address);
            const balanceAfter2 = await wftm.balanceOf(signer2.address);
            const share2 = votingPower2.mul(ONE).div(votingPower1.add(votingPower2));

            expectApproxEq(balanceAfter1.sub(balanceBefore1), share1);
            expectApproxEq(balanceAfter2.sub(balanceBefore2), share2);
        });

        it('can carry over allocation caps from the previous epoch', async () => {
            await controller.setMaBeetsAllocPointCapsForEpoch([
                {farmId: 0, allocPoints: 2000},
                {farmId: 1, allocPoints: 3500}
            ]);

            await advanceTimeAndBlock(EPOCH_DURATION_IN_SECONDS);
            const nextEpoch = await controller.getNextEpochTimestamp();

            const before = await controller.getMaBeetsAllocPointCapsForEpoch(nextEpoch);
            
            await controller.reuseCurrentMaBeetsAllocPointCapsForNextEpoch();

            const after = await controller.getMaBeetsAllocPointCapsForEpoch(nextEpoch);

            expect(before[0]).to.eq(0);
            expect(before[1]).to.eq(0);

            expect(after[0]).to.eq(2000);
            expect(after[1]).to.eq(3500);
        });

        it('correctly allocates points from multiple relics and committe with farm caps', async () => {
            await controller.connect(signer1).setVotesForRelic(
                relicId1,
                [
                    {farmId: 0, amount: votingPower1.div(4)},
                    {farmId: 1, amount: votingPower1.div(4)},
                    {farmId: 2, amount: votingPower1.div(4)},
                    {farmId: 3, amount: votingPower1.div(4)},
                ]
            );

            await controller.connect(signer2).setVotesForRelic(
                relicId2,
                [
                    {farmId: 0, amount: votingPower2.div(4)},
                    {farmId: 4, amount: votingPower2.div(4)},
                    {farmId: 8, amount: votingPower2.div(4)},
                    {farmId: 9, amount: votingPower2.div(4)},
                ]
            );

            await controller.setMaBeetsAllocPointCapsForEpoch([
                {farmId: 0, allocPoints: 2000},
                {farmId: 1, allocPoints: 3500}
            ]);

            await controller.setCommitteeFarmAllocationsForEpoch([
                {farmId: 0, allocPoints: 10000},
                {farmId: 1, allocPoints: 10000},
                {farmId: 2, allocPoints: 10000},
            ]);

            await advanceTimeAndBlock(EPOCH_DURATION_IN_SECONDS);
            const currentEpoch = await controller.getCurrentEpochTimestamp();
            const totalVotingPower = await controller.getTotalVotesForEpoch(currentEpoch);
            const totalUncappedVotesForEpoch = totalVotingPower
                .sub(votingPower1.div(4))
                .sub(votingPower1.div(4))
                .sub(votingPower2.div(4));
            const uncappedAllocPoints = BigNumber.from(64500);

            const allocations = await controller.getFarmAllocationsForEpoch(currentEpoch)
            
            expect(allocations[0]).to.eq(2000 + 10000); // cap + committee alloc
            expect(allocations[1]).to.eq(3500 + 10000); // cap + committee alloc
            
            const maBeetsAllocPointsForFarm2 = uncappedAllocPoints
                .mul(votingPower1.div(4).mul(ONE).div(totalUncappedVotesForEpoch)).div(ONE);

            expect(allocations[2]).to.eq(maBeetsAllocPointsForFarm2.add(10000)); //mabeets + committee alloc
            expect(allocations[3]).to.eq(uncappedAllocPoints.mul(votingPower1.div(4).mul(ONE).div(totalUncappedVotesForEpoch)).div(ONE));
            expect(allocations[4]).to.eq(uncappedAllocPoints.mul(votingPower2.div(4).mul(ONE).div(totalUncappedVotesForEpoch)).div(ONE));
            expect(allocations[8]).to.eq(uncappedAllocPoints.mul(votingPower2.div(4).mul(ONE).div(totalUncappedVotesForEpoch)).div(ONE));
            expect(allocations[9]).to.eq(uncappedAllocPoints.mul(votingPower2.div(4).mul(ONE).div(totalUncappedVotesForEpoch)).div(ONE));
      
        });
    });
})


function expectApproxEq(actual: BigNumber, expected: BigNumber, error: BigNumberish = 1): void {
    expect(actual).to.be.at.least(expected.sub(error));
    expect(actual).to.be.at.most(expected.add(error));
}