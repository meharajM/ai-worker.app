/**
 * playwright/ToolRegistry.ts — Centralized tool instantiation.
 *
 * Responsibilities:
 *   1. Tool Collection: Aggregates all individual PlaywrightTool classes into a single list.
 *   2. Dependency Injection: Instantiates tools and prepares them for registration.
 *
 * Design decision: By centralizing tool instantiation, we keep PlaywrightService
 *   ignorant of the specific tool classes, following the Open/Closed Principle.
 *   Adding a new tool only requires updating this registry.
 *
 * Consumed by: PlaywrightService (PlaywrightService.ts)
 */

import { PlaywrightTool } from './PlaywrightTool';
import { NavigateTool } from './tools/NavigateTool';
import { ScreenshotTool } from './tools/ScreenshotTool';
import { ClickTool } from './tools/ClickTool';
import { GetStateTool } from './tools/GetStateTool';
import { GetInteractiveElementsTool } from './tools/GetInteractiveElementsTool';
import { FillTool } from './tools/FillTool';
import { WaitForElementTool } from './tools/WaitForElementTool';
import { TypeTool } from './tools/TypeTool';
import { ClickTextTool } from './tools/ClickTextTool';
import { NewTabTool, SwitchTabTool, CloseTabTool, GetTabsTool } from './tools/TabTools';
import { SelectOptionTool, UploadFileTool, HoverTool, PressTool, ScrollTool, DragDropTool } from './tools/InputTools';
import { GetPageContentTool, ExtractDataTool, BackgroundScrapeTool } from './tools/ExtractionTools';
import { EvaluateTool, HandleDialogTool, SwitchFrameTool, FindByXpathTool, CheckElementTool, SetViewportTool } from './tools/AdvancedTools';
import { GetCookiesTool, SetCookieTool } from './tools/SessionTools';
import { GoBackTool, GoForwardTool, WaitForNavigationTool } from './tools/MiscTools';
import { BrowserActionSequenceTool, WebSearchTool, FillFormTool } from './tools/TurboTools';

/**
 * Returns a complete list of all implemented PlaywrightTool instances.
 * This is called by PlaywrightService during initialization.
 *
 * @returns An array of PlaywrightTool instances.
 */
export function getPlaywrightTools(): PlaywrightTool[] {
    return [
        new NavigateTool(),
        new ScreenshotTool(),
        new ClickTool(),
        new GetStateTool(),
        new GetInteractiveElementsTool(),
        new FillTool(),
        new WaitForElementTool(),
        new TypeTool(),
        new ClickTextTool(),
        new NewTabTool(),
        new SwitchTabTool(),
        new CloseTabTool(),
        new GetTabsTool(),
        new SelectOptionTool(),
        new UploadFileTool(),
        new HoverTool(),
        new PressTool(),
        new ScrollTool(),
        new DragDropTool(),
        new GetPageContentTool(),
        new ExtractDataTool(),
        new BackgroundScrapeTool(),
        new EvaluateTool(),
        new HandleDialogTool(),
        new SwitchFrameTool(),
        new FindByXpathTool(),
        new CheckElementTool(),
        new SetViewportTool(),
        new GetCookiesTool(),
        new SetCookieTool(),
        new GoBackTool(),
        new GoForwardTool(),
        new WaitForNavigationTool(),
        new BrowserActionSequenceTool(),
        new WebSearchTool(),
        new FillFormTool()
    ];
}
