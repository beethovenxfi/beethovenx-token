//@ts-ignore
import { ethers } from 'hardhat';

/*
WBTC: 0x9d78950bc4C531D32C3F874120F0B96213D81DFC 2692
WETH: 0xfBD49f16d9fc6566aE41C20026DDCf3bADb6ba9F 130694
BAL: 0x9c2eE4065F5BcaF2220c6eA788829eEd80aec503 2778032
USDC: 0x0a35823b2C0a025D97e4002aec5038b96087942D 17417832
uUSDwETH-DEC: 0xde54EaA971e55d11abF68d01763F9BB9e356dceF 9270106
DAI: 0x510CD68b4Bdd8cd2fd6e93afe368F0F4e17791F8 7330413
 */

const WETH = '0xfBD49f16d9fc6566aE41C20026DDCf3bADb6ba9F';
const MASTER_CHEF = '0x42BaFb14a27295A6e9Ff2c806B8F367E273BD2e4';

async function main() {
    const token = await ethers.getContractAt('contracts/BeethovenxMasterChef.sol:ERC20', WETH);
    await token.approve(MASTER_CHEF, '1000000000000000000000');

    const masterChef = await ethers.getContractAt('BeethovenxMasterChef', MASTER_CHEF);

    const tx = await masterChef.deposit(2, '1000000000000000000', '0xd3F32d840f684061eEB2B6c6B78cA346C3fe0030');
    const receipt = await tx.wait();

    console.log('receipt', receipt);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
