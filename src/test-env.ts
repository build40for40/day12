import { fakeD1 } from './fake-d1'
import type { DailyParams, Env } from './types'

export interface FakeInstance {
  id: string
  params: DailyParams
  status: InstanceStatus
  restarts: (WorkflowInstanceRestartOptions | undefined)[]
}

/** A Workflow binding that keeps its instances in memory and runs nothing, with the same id rules as the real one. */
export function fakeWorkflow(): Workflow<DailyParams> & { instances: Map<string, FakeInstance> } {
  const instances = new Map<string, FakeInstance>()
  const handle = (instance: FakeInstance) =>
    ({
      id: instance.id,
      status: async () => instance.status,
      restart: async (options?: WorkflowInstanceRestartOptions) => {
        instance.restarts.push(options)
        instance.status = { status: 'queued' }
      },
    }) as unknown as WorkflowInstance
  return {
    instances,
    create: async (options?: WorkflowInstanceCreateOptions<DailyParams>) => {
      const id = options?.id ?? crypto.randomUUID()
      if (instances.has(id)) throw new Error(`instance.already_exists: ${id}`)
      const instance: FakeInstance = { id, params: options!.params!, status: { status: 'queued' }, restarts: [] }
      instances.set(id, instance)
      return handle(instance)
    },
    get: async (id: string) => {
      const instance = instances.get(id)
      if (!instance) throw new Error('instance.not_found')
      return handle(instance)
    },
  } as unknown as Workflow<DailyParams> & { instances: Map<string, FakeInstance> }
}

export function fakeEnv(): Env & { sqlite: ReturnType<typeof fakeD1>['sqlite']; DAILY: ReturnType<typeof fakeWorkflow> } {
  const { db, sqlite } = fakeD1()
  return {
    DB: db,
    sqlite,
    PULL_TOKEN: 'x',
    POSTMARK_SERVER_TOKEN: 'fake-token',
    EMAIL_FROM: 'fake.sender@example.com',
    PUBLIC_BASE_URL: 'https://brief.example.com/',
    ALLOWED_ORIGIN: 'https://site.example.com',
    POSTMARK_TRANSACTIONAL_STREAM: 'outbound',
    POSTMARK_BROADCAST_STREAM: 'broadcast',
    DAILY: fakeWorkflow(),
  }
}
