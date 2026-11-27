declare module 'discord-rpc' {
  export class Client {
    constructor(options: { transport: 'ipc' })
    login(options: { clientId: string }): Promise<void>
    setActivity(activity: Record<string, unknown>): Promise<void>
    request(command: string, args: Record<string, unknown>): Promise<unknown>
    clearActivity(): Promise<void>
    destroy(): Promise<void>
    on(event: string, listener: (...args: unknown[]) => void): void
  }
}
