package com.quicodomingo.murmur

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * One block of the notes: text with a format, a marked moment or a photo, each with the meeting
 * second it was written at, as the computer's editor stamps them (as Notes.swift on the iPhone).
 */
data class NoteBlock(
    val id: String = UUID.randomUUID().toString(),
    val kind: Kind = Kind.PARAGRAPH,
    val text: String = "",
    val t: Double? = null,
    val checked: Boolean = false,
    /** A photo's file, relative to the data folder ("screens/<meeting>/<ms>.jpg"). */
    val photo: String? = null,
) {
    enum class Kind { PARAGRAPH, HEADING, BULLET, TASK, MARK, PHOTO }

    val isText: Boolean get() = kind != Kind.MARK && kind != Kind.PHOTO
    val isEmpty: Boolean get() = isText && text.isBlank()
}

/** What counts as a note (for "Notes · 3"). */
fun List<NoteBlock>.noteCount(): Int = count { !it.isEmpty }

/** There's always an empty line at the end to write on. */
fun MutableList<NoteBlock>.ensureTrailing() {
    val last = lastOrNull()
    if (last == null || !(last.isEmpty && last.kind == NoteBlock.Kind.PARAGRAPH)) add(NoteBlock())
}

/** A marked moment or a photo goes before the empty line at the end, where typing goes on. */
fun MutableList<NoteBlock>.insertBeforeTrailing(block: NoteBlock) {
    val last = lastOrNull()
    if (last != null && last.isEmpty && last.kind == NoteBlock.Kind.PARAGRAPH) add(size - 1, block) else add(block)
}

/**
 * The notes as the computer stores them: a TipTap document (headings, paragraphs, bullet and task
 * lists, each block with `attrs.t`), the marked moments (`marks`) and the photos as its
 * screenshots (`screens`).
 */
object NotesDoc {
    fun encode(blocks: List<NoteBlock>): JSONObject? {
        val content = JSONArray()
        fun text(s: String) = JSONArray().apply { if (s.isNotEmpty()) put(JSONObject().put("type", "text").put("text", s)) }
        fun attrs(b: NoteBlock) = JSONObject().apply { b.t?.let { put("t", it) } }
        for (block in blocks) {
            if (block.isEmpty || block.kind == NoteBlock.Kind.PHOTO) continue
            when (block.kind) {
                NoteBlock.Kind.HEADING ->
                    content.put(JSONObject().put("type", "heading").put("attrs", attrs(block).put("level", 2)).put("content", text(block.text)))
                NoteBlock.Kind.BULLET, NoteBlock.Kind.TASK -> {
                    val bullet = block.kind == NoteBlock.Kind.BULLET
                    val list = if (bullet) "bulletList" else "taskList"
                    val itemAttrs = attrs(block).apply { if (!bullet) put("checked", block.checked) }
                    val item = JSONObject().put("type", if (bullet) "listItem" else "taskItem").put("attrs", itemAttrs)
                        .put("content", JSONArray().put(JSONObject().put("type", "paragraph").put("content", text(block.text))))
                    // Consecutive items of the same kind are one list.
                    val previous = if (content.length() > 0) content.getJSONObject(content.length() - 1) else null
                    if (previous?.optString("type") == list) previous.getJSONArray("content").put(item)
                    else content.put(JSONObject().put("type", list).put("content", JSONArray().put(item)))
                }
                // The mark goes in the paragraph itself (`attrs.mark`), as on the iPhone.
                NoteBlock.Kind.MARK ->
                    content.put(JSONObject().put("type", "paragraph").put("attrs", attrs(block).put("mark", true)).put("content", text(block.text)))
                else -> content.put(JSONObject().put("type", "paragraph").put("attrs", attrs(block)).put("content", text(block.text)))
            }
        }
        return if (content.length() == 0) null else JSONObject().put("type", "doc").put("content", content)
    }

    fun marks(blocks: List<NoteBlock>): JSONArray =
        JSONArray(blocks.filter { it.kind == NoteBlock.Kind.MARK }.mapNotNull { b -> b.t?.let { JSONObject().put("t", it) } })

    fun screens(blocks: List<NoteBlock>): JSONArray =
        JSONArray(blocks.filter { it.kind == NoteBlock.Kind.PHOTO }.mapNotNull { b -> b.photo?.let { JSONObject().put("t", b.t ?: 0.0).put("path", it) } })

    /** The other way: a meeting's document, marks and photos (each photo after the last block written before it). */
    fun decode(doc: JSONObject?, marks: Set<Double>, screens: JSONArray?, markLabel: String): List<NoteBlock> {
        fun flat(node: JSONObject): String {
            if (node.has("text")) return node.optString("text")
            val children = node.optJSONArray("content") ?: return ""
            return (0 until children.length()).joinToString("") { flat(children.getJSONObject(it)) }
        }
        fun t(node: JSONObject): Double? = node.optJSONObject("attrs")?.let { if (it.has("t") && !it.isNull("t")) it.optDouble("t") else null }

        val blocks = mutableListOf<NoteBlock>()
        val nodes = doc?.optJSONArray("content") ?: JSONArray()
        for (i in 0 until nodes.length()) {
            val node = nodes.getJSONObject(i)
            when (node.optString("type")) {
                "heading" -> blocks.add(NoteBlock(kind = NoteBlock.Kind.HEADING, text = flat(node), t = t(node)))
                "bulletList", "orderedList", "taskList" -> {
                    val items = node.optJSONArray("content") ?: JSONArray()
                    for (j in 0 until items.length()) {
                        val item = items.getJSONObject(j)
                        val task = item.optString("type") == "taskItem"
                        val checked = item.optJSONObject("attrs")?.optBoolean("checked") ?: false
                        blocks.add(NoteBlock(kind = if (task) NoteBlock.Kind.TASK else NoteBlock.Kind.BULLET, text = flat(item), t = t(item), checked = checked))
                    }
                }
                else -> {
                    val text = flat(node)
                    val marked = node.optJSONObject("attrs")?.optBoolean("mark") ?: false
                    val at = t(node)
                    if (at != null && (marked || at in marks)) blocks.add(NoteBlock(kind = NoteBlock.Kind.MARK, text = text, t = at))
                    else if (text.isNotEmpty()) blocks.add(NoteBlock(kind = NoteBlock.Kind.PARAGRAPH, text = text, t = at))
                }
            }
        }
        // Marks saved without a paragraph (older recordings).
        for (at in marks.sorted()) {
            if (blocks.none { it.kind == NoteBlock.Kind.MARK && it.t == at }) {
                val after = blocks.indexOfLast { (it.t ?: 0.0) <= at }
                blocks.add(after + 1, NoteBlock(kind = NoteBlock.Kind.MARK, text = markLabel, t = at))
            }
        }
        for (i in 0 until (screens?.length() ?: 0)) {
            val screen = screens!!.getJSONObject(i)
            val path = screen.optString("path").ifEmpty { continue }
            val at = screen.optDouble("t", 0.0)
            val after = blocks.indexOfLast { (it.t ?: 0.0) <= at }
            blocks.add(after + 1, NoteBlock(kind = NoteBlock.Kind.PHOTO, t = at, photo = path))
        }
        return blocks
    }
}
