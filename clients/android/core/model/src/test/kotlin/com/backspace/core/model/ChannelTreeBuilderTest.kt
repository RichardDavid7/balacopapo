package com.backspace.core.model

import org.junit.Assert.assertEquals
import org.junit.Test

class ChannelTreeBuilderTest {

    @Test
    fun `preserves uncategorized channels, categories, subcategories, and channel positions`() {
        val space = Space(
            id = "s1",
            name = "Espaço",
            categories = listOf(
                ChannelCategory(id = "c2", name = "Jogos", position = 2),
                ChannelCategory(id = "c1", name = "Geral", position = 1),
                ChannelCategory(id = "c1_sub", parentId = "c1", name = "Sub-calls", position = 0),
            ),
            channels = listOf(
                Channel(id = "ch_root", name = "boas-vindas", type = "text", position = 0),
                Channel(id = "ch_v1", categoryId = "c1", name = "Call 1", type = "voice", position = 1),
                Channel(id = "ch_t1", categoryId = "c1", name = "chat-geral", type = "text", position = 0),
                Channel(id = "ch_sub", categoryId = "c1_sub", name = "Sala Secreta", type = "voice", position = 0),
                Channel(id = "ch_j", categoryId = "c2", name = "fps", type = "text", position = 0),
            ),
        )

        val keys = ChannelTreeBuilder.build(space).map { "${it.depth}:${it.stableKey}" }
        assertEquals(
            listOf(
                "0:ch:ch_root",
                "0:cat:c1",
                "1:ch:ch_t1",
                "1:ch:ch_v1",
                "1:cat:c1_sub",
                "2:ch:ch_sub",
                "0:cat:c2",
                "1:ch:ch_j",
            ),
            keys,
        )
    }
}
