import { Signature, splitSignature } from '@ethersproject/bytes'
import { AddressZero, HashZero } from '@ethersproject/constants'
import { NotificationData } from '@sushiswap/ui'
import { useCallback, useMemo, useState } from 'react'
import {
  useAccount,
  useContractRead,
  useContractWrite,
  useNetwork,
  usePrepareContractWrite,
  UserRejectedRequestError,
  useSignTypedData,
} from 'wagmi'

import { BENTOBOX_ADDRESS, getBentoBoxContractConfig } from './useBentoBoxContract'
import { ApprovalState } from './useERC20ApproveCallback'

// returns a variable indicating the state of the approval and a function which approves if necessary or early returns
export function useBentoBoxApproveCallback({
  masterContract,
  watch,
  onSignature,
  onSuccess,
  enabled = true,
}: {
  masterContract?: string
  watch: boolean
  onSignature?(payload: Signature): void
  onSuccess?(data: NotificationData): void
  enabled?: boolean
}): [ApprovalState, Signature | undefined, () => Promise<void>] {
  const { address, connector } = useAccount()
  const { chain } = useNetwork()

  const { config } = usePrepareContractWrite({
    ...getBentoBoxContractConfig(chain?.id),
    functionName: 'setMasterContractApproval',
    args: [address, masterContract, true, 0, HashZero, HashZero],
    enabled,
  })

  const { writeAsync } = useContractWrite(config)

  const { data: isBentoBoxApproved, isLoading } = useContractRead({
    ...getBentoBoxContractConfig(chain?.id),
    functionName: 'masterContractApproved',
    args: [masterContract, address],
    // This should probably always be true anyway...
    watch,
    enabled: enabled && Boolean(address && masterContract !== AddressZero),
  })

  const { refetch: getNonces } = useContractRead({
    ...getBentoBoxContractConfig(chain?.id),
    functionName: 'nonces',
    args: [address ? address : AddressZero],
    enabled: false,
  })

  const [signature, setSignature] = useState<Signature>()

  const { signTypedDataAsync } = useSignTypedData()

  // check the current approval status
  const approvalState: ApprovalState = useMemo(() => {
    if (isLoading || isBentoBoxApproved === undefined) return ApprovalState.UNKNOWN
    if (signature && !isBentoBoxApproved) return ApprovalState.PENDING
    return isBentoBoxApproved ? ApprovalState.APPROVED : ApprovalState.NOT_APPROVED
  }, [isBentoBoxApproved, signature, isLoading])

  const legacyApproval = useCallback(async () => {
    if (
      !address ||
      !chain ||
      !(chain.id in BENTOBOX_ADDRESS) ||
      !masterContract ||
      approvalState !== ApprovalState.NOT_APPROVED ||
      !writeAsync
    ) {
      return
    }

    const data = await writeAsync()
    if (onSuccess) {
      const ts = new Date().getTime()
      onSuccess({
        type: 'approval',
        chainId: chain?.id,
        txHash: data.hash,
        promise: data.wait(),
        summary: {
          pending: `Approving BentoBox Master Contract`,
          completed: `Successfully approved the master contract`,
          failed: 'Something went wrong approving the master contract',
        },
        groupTimestamp: ts,
        timestamp: ts,
      })
    }
  }, [address, approvalState, chain, masterContract, onSuccess, writeAsync])

  const approveBentoBox = useCallback(async (): Promise<void> => {
    if (
      !address ||
      !chain ||
      !(chain.id in BENTOBOX_ADDRESS) ||
      !masterContract ||
      approvalState !== ApprovalState.NOT_APPROVED
    ) {
      return
    }

    if (!masterContract) {
      console.error('no master contract')
      return
    }

    if (approvalState !== ApprovalState.NOT_APPROVED) {
      console.error('approve was called unnecessarily')
      return
    }

    // Use regular approvals for safe apps
    if (connector && connector.id === 'safe') {
      return await legacyApproval()
    }

    const { data: nonces } = await getNonces()

    try {
      const data = await signTypedDataAsync({
        domain: {
          name: 'BentoBox V1',
          chainId: chain.id,
          verifyingContract: BENTOBOX_ADDRESS[chain.id],
        },
        types: {
          SetMasterContractApproval: [
            { name: 'warning', type: 'string' },
            { name: 'user', type: 'address' },
            { name: 'masterContract', type: 'address' },
            { name: 'approved', type: 'bool' },
            { name: 'nonce', type: 'uint256' },
          ],
        },
        value: {
          warning: 'Give FULL access to funds in (and approved to) BentoBox?',
          user: address,
          masterContract,
          approved: true,
          nonce: nonces,
        },
      })
      setSignature(splitSignature(data))
      onSignature && onSignature(splitSignature(data))
    } catch (e: unknown) {
      if (e instanceof UserRejectedRequestError) return
      console.error('Error approving BentoBox, attempting regular approval instead', e)
      await legacyApproval()
    }
  }, [
    address,
    chain,
    masterContract,
    approvalState,
    connector,
    getNonces,
    legacyApproval,
    signTypedDataAsync,
    onSignature,
  ])

  return useMemo(() => [approvalState, signature, approveBentoBox], [approvalState, approveBentoBox, signature])
}
