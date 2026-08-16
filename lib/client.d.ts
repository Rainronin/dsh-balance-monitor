import type { SlotComponent } from '@deepseek-ai/dsh-client-ui-slots';
import type { BalanceClientWire } from './types.js';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        'sidebar.footer.action': {
            kind: 'list';
            scope: 'root';
            owner: {
                wide: boolean;
            };
        };
    }
}
/** 浏览器侧 cordis 上下文的最小结构面（slot 注册） */
interface ClientCtx {
    slots: {
        register(options: {
            name: 'sidebar.footer.action';
            id: string;
            order?: number;
            inject: () => BadgeInjected;
        }, component: SlotComponent<{
            wide: boolean;
        } & BadgeInjected>): () => void;
    };
}
/** 客户端依赖的 cordis 服务 */
export declare const inject: string[];
/** 徽章注入面：由 apply 闭包提供，组件只管渲染与轮询节奏 */
interface BadgeInjected {
    get(): Promise<BalanceClientWire>;
    refresh(): Promise<BalanceClientWire>;
}
/** 浏览器插件主体：注册侧边栏徽章（数据经官方 RPC 协议直调，见 callBalance） */
export declare function apply(ctx: ClientCtx): void;
export {};
