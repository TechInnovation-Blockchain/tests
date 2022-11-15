import { Zero } from '@ethersproject/constants'
import { TransactionRequest } from '@ethersproject/providers'
import { Amount, SUSHI, SUSHI_ADDRESS, Token } from '@sushiswap/currency'
import { NotificationData } from '@sushiswap/ui'
import { Dispatch, SetStateAction, useCallback, useMemo } from 'react'
import { erc20ABI, useAccount, useContractReads } from 'wagmi'
import { ReadContractsConfig, SendTransactionResult } from 'wagmi/actions'

import {
  getMasterChefContractConfig,
  getMasterChefContractV2Config,
  useMasterChefContract,
} from '../useMasterChefContract'
import { useSendTransaction } from '../useSendTransaction'

export enum Chef {
  MASTERCHEF,
  MASTERCHEF_V2,
  MINICHEF,
}

interface UseMasterChefReturn extends Pick<ReturnType<typeof useContractReads>, 'isLoading' | 'isError'> {
  balance: Amount<Token> | undefined
  harvest: undefined | (() => void)
  pendingSushi: Amount<Token> | undefined
  isWritePending: boolean
  isWriteError: boolean
}

interface UseMasterChefParams {
  chainId: number
  chef: Chef
  pid: number
  token: Token
  enabled?: boolean
  onSuccess?(data: NotificationData): void
  watch?: boolean
}

type UseMasterChef = (params: UseMasterChefParams) => UseMasterChefReturn

export const useMasterChef: UseMasterChef = ({
  chainId,
  watch = true,
  chef,
  pid,
  token,
  enabled = true,
  onSuccess,
}) => {
  const { address } = useAccount()
  const contract = useMasterChefContract(chainId, chef)
  const config = useMemo(() => getMasterChefContractConfig(chainId, chef), [chainId, chef])
  const v2Config = useMemo(() => getMasterChefContractV2Config(chainId), [chainId])

  const contracts = useMemo(() => {
    const inputs: ReadContractsConfig['contracts'] = []

    if (!chainId) return []

    if (enabled && chainId in SUSHI_ADDRESS) {
      inputs.push({
        chainId,
        addressOrName: SUSHI_ADDRESS[chainId],
        contractInterface: erc20ABI,
        functionName: 'balanceOf',
        args: [config.addressOrName],
      })
    }

    if (enabled && !!address && config.addressOrName) {
      inputs.push({
        ...config,
        functionName: 'userInfo',
        args: [pid, address],
      })
    }

    if (enabled && !!address && !!v2Config.addressOrName) {
      inputs.push({
        ...v2Config,
        functionName: 'pendingSushi',
        args: [pid, address],
      })
    }

    return inputs
  }, [address, chainId, config, enabled, pid, v2Config])

  const { data, isLoading, isError } = useContractReads({
    contracts,
    watch,
    keepPreviousData: true,
    enabled: contracts.length > 0 && enabled,
  })

  const [sushiBalance, balance, pendingSushi] = useMemo(() => {
    const copy = data ? [...data] : []
    const _sushiBalance = Boolean(chainId && SUSHI_ADDRESS[chainId]) && enabled ? copy.shift() : undefined
    const _balance = !!address && enabled && config.addressOrName ? copy.shift()?.amount : undefined
    const _pendingSushi = enabled && !!v2Config.addressOrName ? copy.shift() : undefined

    const balance = Amount.fromRawAmount(token, _balance ? _balance.toString() : 0)
    const pendingSushi = SUSHI[chainId]
      ? Amount.fromRawAmount(SUSHI[chainId], _pendingSushi ? _pendingSushi.toString() : 0)
      : undefined
    const sushiBalance = SUSHI[chainId]
      ? Amount.fromRawAmount(SUSHI[chainId], _sushiBalance ? _sushiBalance.toString() : 0)
      : undefined
    return [sushiBalance, balance, pendingSushi]
  }, [address, chainId, config.addressOrName, data, enabled, token, v2Config.addressOrName])

  const onSettled = useCallback(
    (data: SendTransactionResult | undefined) => {
      if (onSuccess && data) {
        const ts = new Date().getTime()
        onSuccess({
          type: 'claimRewards',
          chainId,
          txHash: data.hash,
          promise: data.wait(),
          summary: {
            pending: `Claiming rewards`,
            completed: `Successfully claimed rewards`,
            failed: `Something went wrong when claiming rewards`,
          },
          groupTimestamp: ts,
          timestamp: ts,
        })
      }
    },
    [chainId, onSuccess]
  )

  const prepare = useCallback(
    (setRequest: Dispatch<SetStateAction<Partial<TransactionRequest & { to: string }>>>) => {
      if (!address || !chainId || !data || !contract) return
      if (chef === Chef.MASTERCHEF) {
        setRequest({
          from: address,
          to: contract.address,
          data: contract.interface.encodeFunctionData('deposit', [pid, Zero]),
        })
      } else if (chef === Chef.MASTERCHEF_V2) {
        if (pendingSushi && sushiBalance && pendingSushi.greaterThan(sushiBalance)) {
          setRequest({
            from: address,
            to: contract.address,
            data: contract.interface.encodeFunctionData('batch', [
              contract.interface.encodeFunctionData('harvestFromMasterChef'),
              contract.interface.encodeFunctionData('harvest', [pid, address]),
            ]),
          })
        } else {
          setRequest({
            from: address,
            to: contract.address,
            data: contract.interface.encodeFunctionData('harvest', [pid, address]),
          })
        }
      } else if (chef === Chef.MINICHEF) {
        setRequest({
          from: address,
          to: contract.address,
          data: contract.interface.encodeFunctionData('harvest', [pid, address]),
        })
      }
    },
    [address, chainId, chef, contract, data, pendingSushi, pid, sushiBalance]
  )

  const {
    sendTransaction: harvest,
    isLoading: isWritePending,
    isError: isWriteError,
  } = useSendTransaction({
    chainId,
    onSettled,
    prepare,
  })

  return useMemo(() => {
    return {
      harvest,
      balance,
      isLoading,
      isError,
      pendingSushi,
      isWritePending,
      isWriteError,
    }
  }, [balance, harvest, isError, isLoading, isWriteError, isWritePending, pendingSushi])
}
