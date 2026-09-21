import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountRegistry } from '../../src/main/accounts/AccountRegistry'

const temporaryDirectories: string[] = []

async function temporaryDataDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'account-registry-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  while (temporaryDirectories.length) {
    const directory = temporaryDirectories.pop()
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
})

describe('AccountRegistry', () => {
  it('starts empty and survives a missing or corrupt file', async () => {
    const directory = await temporaryDataDirectory()
    const registry = new AccountRegistry(directory)
    await expect(registry.list()).resolves.toEqual([])

    await writeFile(path.join(directory, 'accounts.json'), '{ not json', 'utf8')
    await expect(registry.list()).resolves.toEqual([])
  })

  it('registers several accounts per bot and keeps them apart', async () => {
    const registry = new AccountRegistry(await temporaryDataDirectory())

    const first = await registry.register({ provider: 'gemini', label: 'Tài khoản 1', profileDirectory: 'p1', authuser: 0 })
    await registry.register({ provider: 'gemini', label: 'Tài khoản 2', profileDirectory: 'p1', authuser: 1 })
    await registry.register({ provider: 'kimi', label: 'Kimi chính', profileDirectory: 'p2' })

    expect(await registry.listFor('gemini')).toHaveLength(2)
    expect(await registry.listFor('kimi')).toHaveLength(1)
    expect((await registry.listFor('gemini'))[0]).toMatchObject({ label: 'Tài khoản 1', authuser: 0 })
    expect(first.id).toBeTruthy()
  })

  it('updates the same account instead of duplicating the same profile', async () => {
    const registry = new AccountRegistry(await temporaryDataDirectory())

    const first = await registry.register({ provider: 'chatgpt', label: 'Tài khoản 1', profileDirectory: 'profile-a' })
    const again = await registry.register({
      provider: 'chatgpt',
      label: 'Alexander Bryant',
      profileDirectory: 'profile-a',
      plan: 'free',
    })

    expect(again.id).toBe(first.id)
    expect(await registry.list()).toHaveLength(1)
    expect(again).toMatchObject({ label: 'Alexander Bryant', plan: 'free' })
  })

  it('updates the same ChatGPT account by email even when it was added through another profile', async () => {
    const registry = new AccountRegistry(await temporaryDataDirectory())

    const first = await registry.register({
      provider: 'chatgpt',
      label: 'Nguyễn Văn A',
      profileDirectory: 'profile-a',
      email: 'nguyenvana@example.com',
      plan: 'free',
    })
    const again = await registry.register({
      provider: 'chatgpt',
      label: 'Nguyễn Văn A',
      profileDirectory: 'profile-b',
      email: 'NguyenVanA@example.com',
      plan: 'plus',
    })

    expect(again.id).toBe(first.id)
    expect(await registry.listFor('chatgpt')).toHaveLength(1)
    expect((await registry.listFor('chatgpt'))[0]).toMatchObject({
      label: 'Nguyễn Văn A',
      email: 'NguyenVanA@example.com',
      plan: 'plus',
      profileDirectory: 'profile-b',
    })
  })

  it('removes a temporary placeholder when the login is an already saved ChatGPT email', async () => {
    const registry = new AccountRegistry(await temporaryDataDirectory())

    const saved = await registry.register({
      provider: 'chatgpt',
      label: 'Nguyễn Văn A',
      profileDirectory: 'profile-old',
      email: 'nguyenvana@example.com',
      plan: 'plus',
    })
    await registry.register({
      provider: 'chatgpt',
      label: 'Tài khoản 2',
      profileDirectory: 'profile-new-placeholder',
    })
    const merged = await registry.register({
      provider: 'chatgpt',
      label: 'Nguyễn Văn A',
      profileDirectory: 'profile-new-placeholder',
      email: 'nguyenvana@example.com',
      plan: 'plus',
    })

    expect(merged.id).toBe(saved.id)
    expect(await registry.listFor('chatgpt')).toHaveLength(1)
    expect((await registry.listFor('chatgpt'))[0]).toMatchObject({
      id: saved.id,
      profileDirectory: 'profile-new-placeholder',
      email: 'nguyenvana@example.com',
    })
  })

  it('marks a quota block with its reset time and can clear it', async () => {
    const registry = new AccountRegistry(await temporaryDataDirectory())
    const account = await registry.register({ provider: 'gemini', label: 'Acc 1', profileDirectory: 'p1' })

    await registry.markQuotaBlocked(account.id, 'Hạn mức sẽ được đặt lại vào 15:13 20 thg 9', '2026-09-20T08:13:00.000Z')
    expect(await registry.listFor('gemini')).toEqual([
      expect.objectContaining({
        quotaNotice: 'Hạn mức sẽ được đặt lại vào 15:13 20 thg 9',
        quotaBlockedUntil: '2026-09-20T08:13:00.000Z',
      }),
    ])

    await registry.clearQuota(account.id)
    const cleared = (await registry.listFor('gemini'))[0]!
    expect(cleared.quotaBlockedUntil).toBeUndefined()
    expect(cleared.quotaNotice).toBeUndefined()
  })

  it('records when an account has been verified as usable', async () => {
    const registry = new AccountRegistry(await temporaryDataDirectory())
    const account = await registry.register({ provider: 'chatgpt', label: 'Acc hoạt động', profileDirectory: 'p1' })

    await registry.markVerified(account.id)

    const verified = (await registry.listFor('chatgpt'))[0]!
    expect(Date.parse(verified.lastVerifiedAt ?? '')).not.toBeNaN()
  })

  it('removes an account and reports what was removed', async () => {
    const registry = new AccountRegistry(await temporaryDataDirectory())
    const account = await registry.register({ provider: 'deepseek', label: 'Acc phụ', profileDirectory: 'p9' })

    await expect(registry.remove(account.id)).resolves.toMatchObject({ label: 'Acc phụ' })
    await expect(registry.list()).resolves.toEqual([])
    await expect(registry.remove('missing')).resolves.toBeUndefined()
  })

  it('deletes only the orphaned profiles during cleanup', async () => {
    const directory = await temporaryDataDirectory()
    const registry = new AccountRegistry(directory)
    const keptProfile = path.join(directory, 'accounts', 'kept')
    const orphanProfile = path.join(directory, 'accounts', 'orphan')
    await mkdir(keptProfile, { recursive: true })
    await mkdir(orphanProfile, { recursive: true })
    await writeFile(path.join(keptProfile, 'cache.bin'), Buffer.alloc(2048))
    await writeFile(path.join(orphanProfile, 'cache.bin'), Buffer.alloc(4096))
    await registry.register({ provider: 'gemini', label: 'Acc giữ lại', profileDirectory: keptProfile })

    const result = await registry.cleanupOrphanProfiles()

    expect(result.removed).toEqual([orphanProfile])
    expect(result.freedBytes).toBe(4096)
    await expect(readFile(path.join(keptProfile, 'cache.bin'))).resolves.toBeTruthy()
  })

  it('clears cache without touching accounts or their login data', async () => {
    const directory = await temporaryDataDirectory()
    const registry = new AccountRegistry(directory)
    const profile = path.join(directory, 'gemini-browser-profile')
    await mkdir(path.join(profile, 'Cache'), { recursive: true })
    await mkdir(path.join(profile, 'Default', 'Code Cache'), { recursive: true })
    await mkdir(path.join(profile, 'Default', 'Network'), { recursive: true })
    await writeFile(path.join(profile, 'Cache', 'junk.bin'), Buffer.alloc(1024))
    await writeFile(path.join(profile, 'Default', 'Code Cache', 'junk.bin'), Buffer.alloc(2048))
    await writeFile(path.join(profile, 'Default', 'Network', 'Cookies'), 'login-data')
    await registry.register({ provider: 'gemini', label: 'Acc 1', profileDirectory: profile })

    const result = await registry.cleanToolCaches([profile])

    expect(result.freedBytes).toBe(3072)
    expect(result.removed).toHaveLength(2)
    // Accounts survive, and so does everything that keeps a user signed in.
    await expect(registry.listFor('gemini')).resolves.toHaveLength(1)
    await expect(readFile(path.join(profile, 'Default', 'Network', 'Cookies'), 'utf8'))
      .resolves.toBe('login-data')
  })
})
