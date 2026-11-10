// Native command rejections are strings. Surface only fixed storage messages;
// arbitrary IPC/OS error text can contain paths, identifiers or key material.
export const missingLocalHistory='Hearth found the key for your saved messages, but the messages themselves are missing from this Windows user account. Keep your original Windows user account and message files, and don’t reset your keys.'
const messages=new Set([
  'Your saved messages couldn’t be opened. They may be locked, damaged or changed in another Hearth window. Don’t delete them. Unlock your computer’s secure key storage and sign in again.',
  missingLocalHistory,
  'Hearth couldn’t find your saved messages from an earlier install of Hearth on this computer. Your original files and keys were not changed.',
  'Hearth found more than one different copy of your saved messages, so it didn’t restore any of them. Don’t delete those copies; keep them until you choose which one to recover.',
  'Your saved messages are already in this Windows user account, so nothing was replaced. Try opening your messages again.',
  'A copy of your saved messages is still in use. Close other Hearth windows and try again. Your original files and keys were not changed.',
  'Your saved messages are here, but the key that unlocks them isn’t available in this Windows user account. Keep the message files, and sign in from the Windows user account you used before.',
  'Hearth couldn’t open your computer’s secure key storage (Windows Credential Manager). Unlock Windows and try again. Your saved messages were not changed.',
  'Something went wrong opening your saved messages. Nothing was changed. Close and reopen Hearth, then try again.',
  'Account keys can only be opened from the main Hearth window.',
])
export function messageStorageError(error:unknown){
  const message=typeof error==='string'?error:error instanceof Error?error.message:''
  return new Error(messages.has(message)?message:'Your saved messages couldn’t be opened or saved. Your existing messages were kept. Close other Hearth windows and sign in again.')
}
