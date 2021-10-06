import { network } from "hardhat"
import { stdout } from "../cli/utils/stdout"
import { printNetwork } from "../cli/utils/network"
import { addMasterChefPool, listPools } from "../cli/contract-interactions/masterchef"

type PoolConfig = {
  lpAddress: string
  allocationPoints: number
}

const zeroAddress = "0x0000000000000000000000000000000000000000"

const intialPools: Record<number, PoolConfig[]> = {
  //opera
  250: [
    {
      // 80/20 BEETS/USDC
      lpAddress: "0x03c6B3f09D2504606936b1A4DeCeFaD204687890",
      allocationPoints: 0,
    },
    // fantom of opera
    {
      lpAddress: "0xcdF68a4d525Ba2E90Fe959c74330430A5a6b8226",
      allocationPoints: 0,
    },
    // grand orchestrar
    {
      lpAddress: "0xd47D2791d3B46f9452709Fa41855a045304D6f9d",
      allocationPoints: 0,
    },
    // steady beets
    {
      lpAddress: "0xd41bF724b6e31311Db582c5388Af6B316e812Fe4",
      allocationPoints: 0,
    },
    // sonata
    {
      lpAddress: "0xf0e2c47d4C9FBBbc2F2E19ACdaA3c773A3ECD221",
      allocationPoints: 0,
    },
    // e-major
    {
      lpAddress: "0xA07De66AeF84e2c01D88a48D57D1463377Ee602b",
      allocationPoints: 0,
    },
    // b-major
    {
      lpAddress: "0x22B30B00e6796Daf710fBE5cAFBFc9Cdd1377f2A",
      allocationPoints: 0,
    },
    // classic trio
    {
      lpAddress: "0x6FDC8415B654B0F60475944A0b9421Dc36ee1363",
      allocationPoints: 0,
    },
    // dance of degens
    {
      lpAddress: "0x72C0eB973Dc95e2d185563f58fC26626CC2e8034",
      allocationPoints: 0,
    },
  ],
  // rinkeby
  4: [
    {
      lpAddress: "0x33276D43aDA054a281d40a11d48310Cdc0156fc2",
      allocationPoints: 10,
    },
    {
      lpAddress: "0x86b03134Ea51903a692aAE8808ce96554012C5bd",
      allocationPoints: 10,
    },
    {
      lpAddress: "0x864e386BBBb8b06cBf060fC0b7587aB5f40d5c9B",
      allocationPoints: 10,
    },
    {
      lpAddress: "0xf453D2AD5cEf4e3f1FD4B81b2d5421a412Fd311f",
      allocationPoints: 10,
    },
  ],
}

async function setupInitialFarmPools() {
  await printNetwork()
  stdout.printInfo(`Setting up initial pools`)
  const pools = intialPools[network.config.chainId!]

  for (const pool of pools) {
    stdout.printStep(`Adding pool to master chef for LP ${pool.lpAddress} with allocation points ${pool.allocationPoints}`)
    const tx = await addMasterChefPool(pool.allocationPoints, pool.lpAddress, zeroAddress)
    stdout.printStepDone(`done with tx ${tx}`)
  }
  stdout.printInfo("Listing all pools: \n")
  await listPools()
}

setupInitialFarmPools().catch((error) => {
  stdout.printError(error.message, error)
  process.exit(1)
})
