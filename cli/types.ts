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
export type TimelockTransactionAction = "queue" | "execute"

export type StoredTimelockTransaction = TimelockTransaction & {
  executed: boolean
  executeTxHash?: string
}
