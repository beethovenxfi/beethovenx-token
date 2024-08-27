// @ts-ignore
import { ethers } from 'hardhat'
import MasterchefCheckpointerAbi from '../abi/MasterchefCheckpointer.json'
import axios from 'axios'

async function run() {
    const masterchefSubgraphUrl = 'https://api.studio.thegraph.com/query/73674/masterchefv2/version/latest'
    const farmId = 171
    const query = `{
pool(id:161){
  users{
    address
  }
}}`

    const response = await axios.post<{ data: { pool: { users: { address: string }[] } } }>(masterchefSubgraphUrl, {
        query,
    })

    const checkpointer = await ethers.getContractAt(
        MasterchefCheckpointerAbi,
        '0x6f2EB72019b093Faa90f198D7Ea7a0A2cb3a10c1',
    )
    const txn = await checkpointer.checkpointUsers(
        farmId,
        response.data.data.pool.users.map((u) => u.address),
    )
    await txn.wait()
}

run().catch((e) => {
    console.log('error', e)
})
