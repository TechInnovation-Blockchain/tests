import { Amount, Currency, Token } from '@sushiswap/currency'
import { JSBI } from '@sushiswap/math'
import { STARGATE_CHAIN_ID, STARGATE_POOL_ADDRESS, STARGATE_POOL_ID } from '@sushiswap/stargate'
import { useSushiXSwapContractWithProvider } from '@sushiswap/wagmi'
import STARGATE_FEE_LIBRARY_V03_ABI from 'abis/stargate-fee-library-v03.json'
import STARGATE_POOL_ABI from 'abis/stargate-pool.json'
import { useMemo } from 'react'
import { useContractRead, useContractReads } from 'wagmi'

export const useBridgeFees = ({
  amount,
  srcChainId,
  srcBridgeToken,
  dstChainId,
  dstBridgeToken,
}: {
  amount?: Amount<Currency>
  srcChainId: number
  srcBridgeToken: Token
  dstChainId: number
  dstBridgeToken: Token
}) => {
  const contract = useSushiXSwapContractWithProvider(srcChainId)

  const { data: stargatePoolResults } = useContractReads({
    contracts: [
      {
        addressOrName: STARGATE_POOL_ADDRESS[srcChainId][srcBridgeToken.address],
        functionName: 'getChainPath',
        args: [STARGATE_CHAIN_ID[dstChainId], STARGATE_POOL_ID[dstChainId][dstBridgeToken.address]],
        contractInterface: STARGATE_POOL_ABI,
        chainId: srcChainId,
      },
      {
        addressOrName: STARGATE_POOL_ADDRESS[srcChainId][srcBridgeToken.address],
        functionName: 'feeLibrary',
        contractInterface: STARGATE_POOL_ABI,
        chainId: srcChainId,
      },
      {
        addressOrName: STARGATE_POOL_ADDRESS[srcChainId][srcBridgeToken.address],
        functionName: 'sharedDecimals',
        contractInterface: STARGATE_POOL_ABI,
        chainId: srcChainId,
      },
    ],
    enabled: Boolean(srcChainId && dstChainId && srcChainId !== dstChainId),
  })

  const adjusted = useMemo(() => {
    if (!amount || !stargatePoolResults?.[2]) return
    const localDecimals = amount.currency.decimals
    const sharedDecimals = stargatePoolResults[2].toNumber()
    if (localDecimals === sharedDecimals) return amount
    return localDecimals > sharedDecimals
      ? amount.asFraction.divide(JSBI.exponentiate(JSBI.BigInt(10), JSBI.BigInt(localDecimals - sharedDecimals)))
      : amount.asFraction.multiply(JSBI.exponentiate(JSBI.BigInt(10), JSBI.BigInt(sharedDecimals - localDecimals)))
  }, [amount, stargatePoolResults?.[2]])

  const { data: getFeesResults } = useContractRead({
    addressOrName: String(stargatePoolResults?.[1]),
    functionName: 'getFees',
    args: [
      STARGATE_POOL_ID[srcChainId][srcBridgeToken.address],
      STARGATE_POOL_ID[dstChainId][dstBridgeToken.address],
      STARGATE_CHAIN_ID[dstChainId],
      contract.address,
      adjusted?.quotient?.toString(),
    ],
    contractInterface: STARGATE_FEE_LIBRARY_V03_ABI,
    chainId: srcChainId,
    enabled: Boolean(
      adjusted && contract && srcChainId && dstChainId && srcChainId !== dstChainId && stargatePoolResults?.[1]
    ),
  })

  return useMemo(() => {
    if (!getFeesResults || !stargatePoolResults?.[2]) {
      return [undefined, undefined, undefined, undefined]
    }
    const localDecimals = amount.currency.decimals
    const sharedDecimals = stargatePoolResults[2].toNumber()

    const eqFee = JSBI.BigInt(getFeesResults.eqFee.toString())
    const eqReward = JSBI.BigInt(getFeesResults.eqReward.toString())
    const lpFee = JSBI.BigInt(getFeesResults.lpFee.toString())
    const protocolFee = JSBI.BigInt(getFeesResults.protocolFee.toString())

    if (localDecimals === sharedDecimals)
      return [
        Amount.fromRawAmount(srcBridgeToken, eqFee),
        Amount.fromRawAmount(srcBridgeToken, eqReward),
        Amount.fromRawAmount(srcBridgeToken, lpFee),
        Amount.fromRawAmount(srcBridgeToken, protocolFee),
      ]

    const _eqFee =
      localDecimals > sharedDecimals
        ? JSBI.multiply(eqFee, JSBI.exponentiate(JSBI.BigInt(10), JSBI.BigInt(localDecimals - sharedDecimals)))
        : JSBI.divide(eqFee, JSBI.exponentiate(JSBI.BigInt(10), JSBI.BigInt(sharedDecimals - localDecimals)))

    const _eqReward =
      localDecimals > sharedDecimals
        ? JSBI.multiply(eqReward, JSBI.exponentiate(JSBI.BigInt(10), JSBI.BigInt(localDecimals - sharedDecimals)))
        : JSBI.divide(eqReward, JSBI.exponentiate(JSBI.BigInt(10), JSBI.BigInt(sharedDecimals - localDecimals)))

    const _lpFee =
      localDecimals > sharedDecimals
        ? JSBI.multiply(lpFee, JSBI.exponentiate(JSBI.BigInt(10), JSBI.BigInt(localDecimals - sharedDecimals)))
        : JSBI.divide(lpFee, JSBI.exponentiate(JSBI.BigInt(10), JSBI.BigInt(sharedDecimals - localDecimals)))

    const _protocolFee =
      localDecimals > sharedDecimals
        ? JSBI.multiply(protocolFee, JSBI.exponentiate(JSBI.BigInt(10), JSBI.BigInt(localDecimals - sharedDecimals)))
        : JSBI.divide(protocolFee, JSBI.exponentiate(JSBI.BigInt(10), JSBI.BigInt(sharedDecimals - localDecimals)))

    return [
      Amount.fromRawAmount(srcBridgeToken, _eqFee),
      Amount.fromRawAmount(srcBridgeToken, _eqReward),
      Amount.fromRawAmount(srcBridgeToken, _lpFee),
      Amount.fromRawAmount(srcBridgeToken, _protocolFee),
    ]
  }, [getFeesResults, srcBridgeToken, stargatePoolResults?.[2]])
}
