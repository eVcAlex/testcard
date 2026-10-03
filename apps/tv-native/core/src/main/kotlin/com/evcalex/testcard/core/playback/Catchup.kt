package com.evcalex.testcard.core.playback

import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.getPlaybackTarget
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.core.sync.SourceLogins
import com.evcalex.testcard.core.xtream.CatchupSplit
import com.evcalex.testcard.core.xtream.XtreamApi
import com.evcalex.testcard.core.xtream.fetchCatchupProgrammes
import com.evcalex.testcard.core.xtream.splitCatchup
import okhttp3.OkHttpClient

/** A channel whose provider keeps past programmes to play back (`playback/catchup.ts`). Xtream only; live playback never needs it. */
class ChannelCatchup(val sourceId: String, val streamId: String, val days: Int)

suspend fun channelCatchup(db: Db, channelId: String): ChannelCatchup? {
    val days = db.read { it.one("SELECT catchup_days FROM channels WHERE id = ?", channelId) { r -> if (r.isNull(0)) null else r.getLong(0).toInt() } }
    if (days == null || days <= 0) return null
    val target = db.read { it.getPlaybackTarget(channelId) } ?: return null
    if (target.source.kind != "xtream") return null
    return ChannelCatchup(target.source.id, target.variant.providerStreamId, days)
}

suspend fun loadCatchupGuide(logins: SourceLogins, http: OkHttpClient, catchup: ChannelCatchup): CatchupSplit {
    val api = XtreamApi({ logins.current(catchup.sourceId) }, http)
    return splitCatchup(api.fetchCatchupProgrammes(catchup.streamId), nowMs(), catchup.days)
}
