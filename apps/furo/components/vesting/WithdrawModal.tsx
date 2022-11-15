import { BigNumber } from '@ethersproject/bignumber'
import { TransactionRequest } from '@ethersproject/providers'
import { CheckCircleIcon } from '@heroicons/react/solid'
import { ChainId } from '@sushiswap/chain'
import { FundSource, useFundSourceToggler } from '@sushiswap/hooks'
import { Button, classNames, DEFAULT_INPUT_BG, Dialog, Dots, Typography } from '@sushiswap/ui'
import { Checker, useFuroVestingContract } from '@sushiswap/wagmi'
import { useSendTransaction } from '@sushiswap/wagmi/hooks/useSendTransaction'
import { useVestingBalance, Vesting } from 'lib'
import { Dispatch, FC, SetStateAction, useCallback, useState } from 'react'
import { useAccount } from 'wagmi'
import { SendTransactionResult } from 'wagmi/actions'

import { useNotifications } from '../../lib/state/storage'

interface WithdrawModalProps {
  vesting?: Vesting
  chainId: ChainId
}

export const WithdrawModal: FC<WithdrawModalProps> = ({ vesting, chainId }) => {
  const [open, setOpen] = useState(false)
  const { value: fundSource, setValue: setFundSource } = useFundSourceToggler(FundSource.WALLET)
  const { address } = useAccount()
  const balance = useVestingBalance(chainId, vesting?.id, vesting?.token)
  const contract = useFuroVestingContract(chainId)
  const [, { createNotification }] = useNotifications(address)

  const onSettled = useCallback(
    async (data: SendTransactionResult | undefined) => {
      if (!data || !balance) return

      const ts = new Date().getTime()
      createNotification({
        type: 'withdrawVesting',
        txHash: data.hash,
        chainId,
        timestamp: ts,
        groupTimestamp: ts,
        promise: data.wait(),
        summary: {
          pending: `Withdrawing ${balance.toSignificant(6)} ${balance.currency.symbol}`,
          completed: `Successfully withdrawn ${balance.toSignificant(6)} ${balance.currency.symbol}`,
          failed: 'Something went wrong withdrawing from vesting schedule',
        },
      })
    },
    [balance, chainId, createNotification]
  )

  const prepare = useCallback(
    (setRequest: Dispatch<SetStateAction<Partial<TransactionRequest & { to: string }>>>) => {
      if (!vesting || !balance || !contract) return

      setRequest({
        from: address,
        to: contract.address,
        data: contract.interface.encodeFunctionData('withdraw', [
          BigNumber.from(vesting.id),
          '0x',
          fundSource === FundSource.BENTOBOX,
        ]),
      })
    },
    [vesting, balance, contract, address, fundSource]
  )

  const { sendTransaction, isLoading: isWritePending } = useSendTransaction({
    chainId,
    prepare,
    onSettled,
    onSuccess() {
      setOpen(false)
    },
    enabled: Boolean(vesting && balance && contract),
  })

  return (
    <>
      <Checker.Connected size="md">
        <Checker.Network size="md" chainId={chainId}>
          <Button
            size="md"
            fullWidth
            disabled={!address || !vesting?.canWithdraw(address) || !balance || !balance?.greaterThan(0)}
            onClick={() => {
              setOpen(true)
            }}
          >
            Withdraw
          </Button>
        </Checker.Network>
      </Checker.Connected>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <Dialog.Content className="space-y-4 !max-w-xs !pb-4">
          <Dialog.Header title="Withdraw" onClose={() => setOpen(false)} />
          <div className="grid items-center grid-cols-2 gap-3">
            <div
              onClick={() => setFundSource(FundSource.WALLET)}
              className={classNames(
                fundSource === FundSource.WALLET ? 'ring-green/70' : 'ring-transparent',
                DEFAULT_INPUT_BG,
                'ring-2 ring-offset-2 ring-offset-slate-800 rounded-xl px-5 py-3 cursor-pointer relative flex flex-col justify-center gap-3 min-w-[140px]'
              )}
            >
              <Typography weight={500} variant="sm" className="!leading-5 tracking-widest text-slate-200">
                Wallet
              </Typography>
              <Typography variant="xs" className="text-slate-400">
                Receive funds in your Wallet
              </Typography>
              {fundSource === FundSource.WALLET && (
                <div className="absolute w-5 h-5 top-3 right-3">
                  <CheckCircleIcon className="text-green/70" />
                </div>
              )}
            </div>
            <div
              onClick={() => setFundSource(FundSource.BENTOBOX)}
              className={classNames(
                fundSource === FundSource.BENTOBOX ? 'ring-green/70' : 'ring-transparent',
                DEFAULT_INPUT_BG,
                'ring-2 ring-offset-2 ring-offset-slate-800 rounded-xl px-5 py-3 cursor-pointer relative flex flex-col justify-center gap-3 min-w-[140px]'
              )}
            >
              <Typography weight={500} variant="sm" className="!leading-5 tracking-widest text-slate-200">
                BentoBox
              </Typography>
              <Typography variant="xs" className="text-slate-400">
                Receive funds in your BentoBox
              </Typography>
              {fundSource === FundSource.BENTOBOX && (
                <div className="absolute w-5 h-5 top-3 right-3">
                  <CheckCircleIcon className="text-green/70" />
                </div>
              )}
            </div>
          </div>
          <Typography variant="xs" weight={400} className="text-slate-300 py-2 text-center">
            There are currently{' '}
            <span className="font-semibold">
              {balance?.toSignificant(6)} {balance?.currency.symbol}
            </span>{' '}
            unlocked tokens available for withdrawal.
          </Typography>
          <Button
            size="md"
            variant="filled"
            fullWidth
            disabled={isWritePending || !balance || !balance?.greaterThan(0)}
            onClick={() => sendTransaction?.()}
          >
            {!vesting?.token ? 'Invalid stream token' : isWritePending ? <Dots>Confirm Withdraw</Dots> : 'Withdraw'}
          </Button>
        </Dialog.Content>
      </Dialog>
    </>
  )
}
