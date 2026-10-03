package com.evcalex.testcard.core.xtream

import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.core.sync.SourceLogins
import java.util.Locale
import java.util.TimeZone
import okhttp3.OkHttpClient

/**
 * What an Xtream provider says about the viewer's account (when it ends, how many streams it allows and how many are in
 * use), asked for on demand and kept a few minutes (`state/account.ts`). Playlists have no such thing.
 */
class SourceAccounts(private val logins: SourceLogins, private val http: OkHttpClient) {
    private class Kept(val account: XtreamAccount?, val at: Long)
    private val known = HashMap<String, Kept>()

    @Synchronized private fun kept(sourceId: String) = known[sourceId]

    fun cached(sourceId: String): XtreamAccount? = kept(sourceId)?.account

    suspend fun account(sourceId: String, fresh: Boolean = false): XtreamAccount? {
        val kept = kept(sourceId)
        if (!fresh && kept != null && nowMs() - kept.at < FRESH_MS) return kept.account
        val account = try { fetchXtreamAccount(logins.current(sourceId), http) } catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error else null }
        synchronized(this) { known[sourceId] = Kept(account, nowMs()) }
        return account
    }

    /**
     * Why a stream would be refused, when the account says: every stream it allows is in use, or it has ended. Asked afresh,
     * since the count changes as other devices start and stop.
     */
    suspend fun problem(sourceId: String): String? {
        val account = account(sourceId, fresh = true) ?: return null
        val status = account.status?.lowercase(Locale.ROOT)
        if ((account.expiresAt != null && account.expiresAt <= nowMs()) || status == "expired") return "Your subscription with this provider has ended. Renew it with them to watch again."
        if (status != null && status != "active") return "The provider says this account is $status."
        val max = account.maxConnections
        val active = account.activeConnections
        if (max != null && active != null && active >= max) {
            return if (max == 1) "Your provider allows one stream at a time, and it is in use. Stop watching on your other device and try again."
            else "Your provider allows $max streams at once, and they are all in use. Stop one on another device and try again."
        }
        return null
    }

    private companion object {
        const val FRESH_MS = 5 * 60 * 1000L
    }
}

private const val DAY_MS = 24L * 60 * 60 * 1000
private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

class AccountLine(val text: String, val warn: Boolean)

/** `{day} {Mon} {year}` in the device's own time zone, as `Date#getDate / getMonth / getFullYear` give it. */
private fun localDate(ms: Long): String {
    val calendar = java.util.Calendar.getInstance(TimeZone.getDefault(), Locale.ROOT).apply { timeInMillis = ms }
    return "${calendar.get(java.util.Calendar.DAY_OF_MONTH)} ${MONTHS[calendar.get(java.util.Calendar.MONTH)]} ${calendar.get(java.util.Calendar.YEAR)}"
}

/** One line about the account for its source's card, and whether it needs the viewer's attention. */
fun describeAccount(account: XtreamAccount, now: Long = nowMs()): AccountLine {
    val parts = ArrayList<String>()
    var warn = false
    val status = account.status?.lowercase(Locale.ROOT)
    if (status != null && status != "active") {
        parts += "Account $status"
        warn = true
    } else if (account.expiresAt != null) {
        val left = account.expiresAt - now
        val on = localDate(account.expiresAt)
        if (left <= 0) {
            parts += "Subscription expired"
            warn = true
        } else if (left < 14 * DAY_MS) {
            val days = maxOf(1L, Math.ceil(left.toDouble() / DAY_MS).toLong())
            parts += "Expires in $days ${if (days == 1L) "day" else "days"} ($on)"
            warn = true
        } else parts += "Expires $on"
    } else parts += "No end date"
    if (account.trial) parts += "Trial"
    val max = account.maxConnections
    if (max != null) {
        val noun = if (max == 1) "stream" else "streams"
        parts += if (account.activeConnections != null) "${account.activeConnections} of $max $noun in use" else "$max $noun at once"
    }
    return AccountLine(parts.joinToString("  ·  "), warn)
}
