import moment from "moment"
import { network } from "hardhat"
import { TimelockTransaction } from "../time-lock-transactions"

const isMainnet = network.name === process.env.MAINNET

const storedTransactions: Record<
  string,
  StoredTimelockTransaction
  // eslint-disable-next-line @typescript-eslint/no-var-requires
> = require(`../../../.timelock/transactions.${network.name}.json`)

export const timelockQueueQuestions = [
  {
    name: "timelock",
    type: "confirm",
    message: "queue on timelock",
  },
  // {
  //   name: 'tla',
  //   message: 'Timelock transaction type',
  //   type: 'list',
  //   when: (answers: any) => answers.timelock,
  //   choices: ['queue', 'execute'],
  //   default: 'queue',
  // },
  {
    name: "eta",
    type: "number",
    message: `eta when to be executed on timelock (default: ${isMainnet ? "48h + 10min" : "8mins"})`,
    when: (answers: any) => answers.timelock,
    default: isMainnet
      ? moment()
          .add(48 * 60 + 10, "minutes")
          .unix()
      : moment().add(8, "minutes").unix(),
  },
]

export type StoredTimelockTransaction = TimelockTransaction & {
  executed: boolean
  executeTxHash?: string
}

export function getTimelockTransactionIds(onlyExecutable = true) {
  if (onlyExecutable) {
    return Object.keys(storedTransactions).filter((transactionId) => {
      return !storedTransactions[transactionId].executed && moment().isSameOrAfter(moment.unix(storedTransactions[transactionId].eta))
    })
  } else {
    return Object.keys(storedTransactions)
  }
}

export function getTimelockTransactions() {
  return Object.keys(storedTransactions)
    .map(
      (transactionId) =>
        `[${transactionId}][${moment.unix(storedTransactions[transactionId].eta)}]  - ${
          storedTransactions[transactionId].targetContract.name
        } - ${storedTransactions[transactionId].targetContract.address} - ${storedTransactions[transactionId].targetFunction.identifier} - ${
          storedTransactions[transactionId].targetFunction.args
        } - executed: ${storedTransactions[transactionId].executed} ${storedTransactions[transactionId].executeTxHash}`
    )
    .join("\n")
}
