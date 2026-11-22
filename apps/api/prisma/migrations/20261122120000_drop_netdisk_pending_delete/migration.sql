-- 退役「待确认删除」机制（JIANGLIUER-102）：站内删除统一为登记托管归档，
-- 隔离清单改存 SiteSetting.netdiskManagedFiles（JSON），该表不再有写入方。
-- 站内删除不碰网盘，网盘文件转托管归档；恢复 = 解除托管后按目录重导。
DROP TABLE IF EXISTS "NetdiskPendingDelete";
