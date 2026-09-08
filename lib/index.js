/**
 * rpchar-bubbles — Host 侧入口。
 * 本包是纯 client 插件:browser 半(bundle)在 ./client.js,由 clientModules
 * 扫描本包的 `dsh.client` 声明后 serve。Host 侧无业务逻辑,apply 保持为空。
 */
export const name = 'rpchar-bubbles'

/** Host 半无逻辑。 */
export function apply() {}