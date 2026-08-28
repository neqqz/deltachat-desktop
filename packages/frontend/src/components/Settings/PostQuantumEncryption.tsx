import React, { useCallback, useEffect, useState } from 'react'

import CoreSettingsSwitch from './CoreSettingsSwitch'
import SettingsButton from './SettingsButton'
import useTranslationFunction from '../../hooks/useTranslationFunction'
import useConfirmationDialog from '../../hooks/dialog/useConfirmationDialog'
import { BackendRemote } from '../../backend-com'
import { selectedAccountId } from '../../ScreenController'
import { useSettingsStore } from '../../stores/settings'
import { getLogger } from '@deltachat-desktop/shared/logger'

import styles from './styles.module.scss'

const log = getLogger('renderer/settings/postQuantumEncryption')

/**
 * "Post-Quantum Encryption" section of Advanced settings.
 *
 * Mirrors ArcaneChat's Android `pref_post_quantum_encryption` preference:
 * - a switch bound to the core `key_gen_mode` config (0 = classic, 1 = PQ),
 * - a "Regenerate Keys Now" button that immediately rotates the encryption
 *   subkey to match the current setting (toggling the switch alone only
 *   affects newly-generated keys, not the existing one),
 * - a status line telling the user whether their *current* key already
 *   matches what the switch is asking for.
 */
export default function PostQuantumEncryptionSettings() {
  const tx = useTranslationFunction()
  const openConfirmationDialog = useConfirmationDialog()

  // "classic" | "pq" | "" (no key yet) | null (still loading)
  const [selfKind, setSelfKind] = useState<string | null>(null)

  const refreshSelfKind = useCallback(async () => {
    try {
      const kind = await BackendRemote.rpc.getSelfEncryptionKind(
        selectedAccountId()
      )
      setSelfKind(kind)
    } catch (error) {
      log.error('getSelfEncryptionKind failed', error)
    }
  }, [])

  useEffect(() => {
    refreshSelfKind()
  }, [refreshSelfKind])

  const rotateKeypairNow = useCallback(async () => {
    const accountId = selectedAccountId()
    const userFeedback = window.__userFeedback
    try {
      await BackendRemote.rpc.rotateKeypairNow(accountId)
      userFeedback({
        type: 'success',
        text: tx('pref_rotate_keypair_now_success'),
      })
    } catch (error) {
      log.error('rotateKeypairNow failed', error)
      userFeedback({
        type: 'error',
        text: tx('pref_rotate_keypair_now_failed'),
      })
    }
    await refreshSelfKind()
  }, [refreshSelfKind, tx])

  // Fires before the switch's own value changes. We apply the config
  // ourselves first (so the confirmation dialog and an immediate rotation
  // see the *new* value), then let CoreSettingsSwitch also set it - the
  // second write is a harmless no-op repeat of the same value.
  const onToggle = useCallback(
    async (newValue: boolean) => {
      const accountId = selectedAccountId()
      try {
        await BackendRemote.rpc.setConfig(
          accountId,
          'key_gen_mode',
          newValue ? '1' : '0'
        )
      } catch (error) {
        log.error('setConfig(key_gen_mode) failed', error)
        return false
      }

      const rotateNow = await openConfirmationDialog({
        header: tx(
          newValue
            ? 'pref_post_quantum_enable_apply_title'
            : 'pref_rotate_keypair_now_confirm_title'
        ),
        message: tx(
          newValue
            ? 'pref_post_quantum_enable_apply_message'
            : 'pref_rotate_keypair_now_confirm_message'
        ),
        confirmLabel: tx('ok'),
        cancelLabel: tx('pref_post_quantum_enable_apply_later'),
      })
      if (rotateNow) {
        await rotateKeypairNow()
      }

      return true // the switch itself always applies; rotation is optional
    },
    [openConfirmationDialog, rotateKeypairNow, tx]
  )

  const summary = useRotateSummary(selfKind)

  return (
    <>
      <CoreSettingsSwitch
        label={tx('pref_post_quantum_encryption')}
        settingsKey='key_gen_mode'
        description={tx('pref_post_quantum_encryption_explain')}
        beforeChange={onToggle}
      />
      <SettingsButton onClick={rotateKeypairNow}>
        {tx('pref_rotate_keypair_now')}
      </SettingsButton>
      {summary && (
        <div className={styles.settingsRowDescription}>{summary}</div>
      )}
    </>
  )
}

/**
 * Compares the "want" state (the `key_gen_mode` switch) against the "have"
 * state (`getSelfEncryptionKind`) to show one of four status lines, exactly
 * like Android's `updateRotateKeypairSummary()`.
 */
function useRotateSummary(selfKind: string | null): string | undefined {
  const tx = useTranslationFunction()
  const settingsStore = useSettingsStore()[0]
  const wantPq = settingsStore?.settings.key_gen_mode === '1'

  if (settingsStore == null || selfKind === null) {
    return undefined
  }
  const havePq = selfKind === 'pq'
  if (wantPq && havePq) {
    return tx('pref_rotate_keypair_now_explain_pq')
  } else if (!wantPq && !havePq) {
    return tx('pref_rotate_keypair_now_explain_classic')
  } else if (wantPq && !havePq) {
    return tx('pref_rotate_keypair_now_explain_pq_pending')
  } else {
    return tx('pref_rotate_keypair_now_explain_classic_pending')
  }
}
