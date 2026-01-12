/**
 * Context Build Job Handler
 *
 * Builds a context pack from specified files for AI agent consumption.
 * Includes token counting and budgeting.
 */

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { JobHandler, JobContext, ValidationResult } from "../../types/job.types";

export interface ContextBuildInput {
  files: string[];
  maxTokens?: number;
  includeMetadata?: boolean;
  format?: "markdown" | "xml" | "json";
}

export interface ContextBuildOutput {
  context: string;
  totalTokens: number;
  filesIncluded: number;
  filesSkipped: number;
  truncated: boolean;
  builtAt: string;
}

interface FileContent {
  path: string;
  name: string;
  extension: string;
  content: string;
  tokens: number;
}

export class ContextBuildHandler implements JobHandler<ContextBuildInput, ContextBuildOutput> {
  // Simple token estimation (4 chars per token on average)
  private readonly CHARS_PER_TOKEN = 4;

  async validate(input: ContextBuildInput): Promise<ValidationResult> {
    const errors: string[] = [];

    if (!input.files || input.files.length === 0) {
      errors.push("files array is required and must not be empty");
    }

    if (input.maxTokens !== undefined && input.maxTokens < 100) {
      errors.push("maxTokens must be at least 100");
    }

    if (input.format && !["markdown", "xml", "json"].includes(input.format)) {
      errors.push("format must be one of: markdown, xml, json");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  async execute(context: JobContext<ContextBuildInput>): Promise<ContextBuildOutput> {
    const { input } = context;
    const maxTokens = input.maxTokens ?? 100000;
    const format = input.format ?? "markdown";

    context.log("info", "Starting context build", {
      fileCount: input.files.length,
      maxTokens,
      format,
    });

    await context.setStage("reading files");

    const fileContents: FileContent[] = [];
    let filesSkipped = 0;
    let totalTokens = 0;

    for (let i = 0; i < input.files.length; i++) {
      context.throwIfCancelled();

      const filePath = input.files[i];
      await context.updateProgress(
        i,
        input.files.length,
        `Reading ${basename(filePath)}`,
      );

      try {
        const content = await readFile(filePath, "utf-8");
        const tokens = this.estimateTokens(content);

        // Check if adding this file would exceed budget
        if (totalTokens + tokens > maxTokens) {
          context.log("warn", "File would exceed token budget, skipping", {
            file: filePath,
            tokens,
            remaining: maxTokens - totalTokens,
          });
          filesSkipped++;
          continue;
        }

        fileContents.push({
          path: filePath,
          name: basename(filePath),
          extension: extname(filePath).slice(1),
          content,
          tokens,
        });

        totalTokens += tokens;
      } catch (error) {
        context.log("warn", "Failed to read file", {
          file: filePath,
          error: error instanceof Error ? error.message : String(error),
        });
        filesSkipped++;
      }
    }

    await context.setStage("building context");
    await context.updateProgress(
      input.files.length,
      input.files.length + 1,
      "Building context pack",
    );

    // Build context in requested format
    const contextStr = this.buildContext(fileContents, format, input.includeMetadata ?? false);

    await context.updateProgress(
      input.files.length + 1,
      input.files.length + 1,
      "Context build complete",
    );

    context.log("info", "Context build complete", {
      filesIncluded: fileContents.length,
      filesSkipped,
      totalTokens,
    });

    return {
      context: contextStr,
      totalTokens,
      filesIncluded: fileContents.length,
      filesSkipped,
      truncated: filesSkipped > 0,
      builtAt: new Date().toISOString(),
    };
  }

  private estimateTokens(content: string): number {
    return Math.ceil(content.length / this.CHARS_PER_TOKEN);
  }

  private buildContext(
    files: FileContent[],
    format: "markdown" | "xml" | "json",
    includeMetadata: boolean,
  ): string {
    switch (format) {
      case "markdown":
        return this.buildMarkdownContext(files, includeMetadata);
      case "xml":
        return this.buildXmlContext(files, includeMetadata);
      case "json":
        return this.buildJsonContext(files, includeMetadata);
      default:
        return this.buildMarkdownContext(files, includeMetadata);
    }
  }

  private buildMarkdownContext(files: FileContent[], includeMetadata: boolean): string {
    const parts: string[] = [];

    if (includeMetadata) {
      parts.push("# Context Pack\n");
      parts.push(`Generated: ${new Date().toISOString()}\n`);
      parts.push(`Files: ${files.length}\n`);
      parts.push(`Total tokens: ${files.reduce((sum, f) => sum + f.tokens, 0)}\n\n`);
      parts.push("---\n\n");
    }

    for (const file of files) {
      parts.push(`## ${file.path}\n\n`);
      parts.push("```" + file.extension + "\n");
      parts.push(file.content);
      if (!file.content.endsWith("\n")) {
        parts.push("\n");
      }
      parts.push("```\n\n");
    }

    return parts.join("");
  }

  private buildXmlContext(files: FileContent[], includeMetadata: boolean): string {
    const parts: string[] = [];

    parts.push('<?xml version="1.0" encoding="UTF-8"?>\n');
    parts.push("<context>\n");

    if (includeMetadata) {
      parts.push("  <metadata>\n");
      parts.push(`    <generated>${new Date().toISOString()}</generated>\n`);
      parts.push(`    <file_count>${files.length}</file_count>\n`);
      parts.push(`    <total_tokens>${files.reduce((sum, f) => sum + f.tokens, 0)}</total_tokens>\n`);
      parts.push("  </metadata>\n");
    }

    parts.push("  <files>\n");
    for (const file of files) {
      parts.push(`    <file path="${this.escapeXml(file.path)}" language="${file.extension}">\n`);
      parts.push(`      <![CDATA[${file.content}]]>\n`);
      parts.push("    </file>\n");
    }
    parts.push("  </files>\n");
    parts.push("</context>\n");

    return parts.join("");
  }

  private buildJsonContext(files: FileContent[], includeMetadata: boolean): string {
    const result: Record<string, unknown> = {};

    if (includeMetadata) {
      result.metadata = {
        generated: new Date().toISOString(),
        fileCount: files.length,
        totalTokens: files.reduce((sum, f) => sum + f.tokens, 0),
      };
    }

    result.files = files.map((file) => ({
      path: file.path,
      name: file.name,
      language: file.extension,
      tokens: file.tokens,
      content: file.content,
    }));

    return JSON.stringify(result, null, 2);
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}
