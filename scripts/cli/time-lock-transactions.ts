import path from "path"
import fs from "fs"
import { ethers, network } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address"
import { StoredTimelockTransaction } from "./utils/timelock"
import { scriptConfig } from "./cli-config"

const storedTransactions: Record<
  string,
  StoredTimelockTransaction
  // eslint-disable-next-line @typescript-eslint/no-var-requires
> = require(`../../.timelock/transactions.${network.name}.json`)
export type TimelockTransactionAction = "queue" | "execute"

const config = scriptConfig[network.config.chainId!]

export type TimelockTransaction = {
  targetContract: {
    name: string
    address: string
  }
  targetFunction: {
    identifier: string
    args: any[]
  }
  // eth sent with transaction
  value: number
  eta: number // in unix seconds
}

export async function manageTimelockTransaction(
  timelockAdmin: SignerWithAddress,
  transaction: TimelockTransaction,
  type: TimelockTransactionAction,
  timelockContractAddress: string
): Promise<string> {
  // stdout.printInfo(`${type} transaction with ${JSON.stringify(transaction)}`);
  const timelockContract = await ethers.getContractAt("Timelock", timelockContractAddress)
  const targetContract = await ethers.getContractAt(transaction.targetContract.name, transaction.targetContract.address)

  // encode function data with params
  const functionFragment = targetContract.interface.getFunction(transaction.targetFunction.identifier)
  const data = targetContract.interface.encodeFunctionData(functionFragment, transaction.targetFunction.args)

  let tx
  if (type === "queue") {
    tx = await timelockContract
      .connect(timelockAdmin)
      .queueTransaction(transaction.targetContract.address, transaction.value, 0, data, transaction.eta)
    const storedTimelockTransaction: StoredTimelockTransaction = {
      ...transaction,
      executed: false,
    }
    fs.writeFileSync(
      path.join(__dirname, `../../../.timelock/transactions.${network.name}.json`),
      JSON.stringify({
        ...storedTransactions,
        [`${transaction.eta}-${transaction.targetContract.name}-${transaction.targetContract.address}-${
          transaction.targetFunction.identifier
        }-[${transaction.targetFunction.args.join(",")}]`]: storedTimelockTransaction,
      })
    )
  } else {
    tx = await timelockContract
      .connect(timelockAdmin)
      .executeTransaction(transaction.targetContract.address, transaction.value, 0, data, transaction.eta)
  }
  const receipt = await tx.wait()
  return receipt.transactionHash
}
