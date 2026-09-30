// cloudfunctions/cleanup/index.js
// 定时清理：回收超时未匹配的房间，避免数据长期堆积
// 触发方式见同目录 config.json（定时触发器，每 5 分钟）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const ROOMS = 'rooms'
const GAMES = 'games'

exports.main = async () => {
  const now = Date.now()
  const result = { rooms: 0, games: 0 }

  // 1) 等待中且已超时的房间 → 直接解散（PRD ROOM-06）
  const expired = await db.collection(ROOMS)
    .where({ status: 'waiting', expireAt: _.lt(now) })
    .limit(100)
    .get()

  for (const room of expired.data) {
    await db.collection(ROOMS).doc(room._id).remove().catch(() => {})
    result.rooms++
  }

  // 2) 已结束超过 1 小时的对局数据 → 清理
  const staleTime = now - 60 * 60 * 1000
  const finished = await db.collection(ROOMS)
    .where({ status: 'finished', updatedAt: _.lt(staleTime) })
    .limit(100)
    .get()

  for (const room of finished.data) {
    await db.collection(GAMES).doc(room._id).remove().catch(() => {})
    result.games++
  }

  console.log('[cleanup]', JSON.stringify(result))
  return result
}
