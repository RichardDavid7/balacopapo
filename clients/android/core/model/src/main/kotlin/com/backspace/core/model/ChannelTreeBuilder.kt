package com.backspace.core.model

sealed interface SpaceTreeItem {
    val stableKey: String
    val depth: Int

    data class CategoryHeader(
        val category: ChannelCategory,
        override val depth: Int,
    ) : SpaceTreeItem {
        override val stableKey: String = "cat:${category.id}"
    }

    data class ChannelRow(
        val channel: Channel,
        val category: ChannelCategory?,
        override val depth: Int,
    ) : SpaceTreeItem {
        override val stableKey: String = "ch:${channel.id}"
    }
}

/**
 * Constrói a árvore exata do Espaço:
 * 1. Canais sem categoria (ordenados por position)
 * 2. Categorias raiz ordenadas por position, cada uma com:
 *    - Seus canais (texto e voz juntos, respeitando position)
 *    - Suas subcategorias (parentId == category.id), recursivamente
 */
object ChannelTreeBuilder {
    fun build(space: Space): List<SpaceTreeItem> {
        val result = mutableListOf<SpaceTreeItem>()
        val categoryById = space.categories.associateBy { it.id }

        // 1. Canais sem categoria (ou categoria inexistente)
        space.channels
            .filter { it.categoryId == null || !categoryById.containsKey(it.categoryId) }
            .sortedBy { it.position }
            .forEach { ch ->
                result.add(SpaceTreeItem.ChannelRow(channel = ch, category = null, depth = 0))
            }

        // 2. Árvore de categorias e subcategorias
        val childrenByParent = space.categories.groupBy { cat ->
            cat.parentId?.takeIf { categoryById.containsKey(it) && it != cat.id }
        }
        val channelsByCategory = space.channels.groupBy { it.categoryId }
        val visited = mutableSetOf<String>()

        fun visit(parentId: String?, depth: Int) {
            val cats = childrenByParent[parentId].orEmpty().sortedBy { it.position }
            for (cat in cats) {
                if (!visited.add(cat.id)) continue
                result.add(SpaceTreeItem.CategoryHeader(category = cat, depth = depth))
                channelsByCategory[cat.id].orEmpty()
                    .sortedBy { it.position }
                    .forEach { ch ->
                        result.add(
                            SpaceTreeItem.ChannelRow(
                                channel = ch,
                                category = cat,
                                depth = depth + 1,
                            ),
                        )
                    }
                visit(cat.id, depth + 1)
            }
        }

        visit(parentId = null, depth = 0)
        return result
    }
}
