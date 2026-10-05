package com.evcalex.testcard.tv.ui.sections

import androidx.compose.runtime.Composable
import com.evcalex.testcard.tv.ui.shell.SectionContext

/** Live TV is the guide: lists on a rail at the left, channels and their programmes across the page. */
@Composable
fun LiveSection(ctx: SectionContext) = GuideScreen(ctx)
