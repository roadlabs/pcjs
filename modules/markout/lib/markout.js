/**
 * @fileoverview Parses simplified Markdown files
 * @author <a href="mailto:Jeff@pcjs.org">Jeff Parsons</a> (@jeffpar)
 * @version 1.0
 * Created 2014-02-14
 *
 * Copyright © 2012-2014 Jeff Parsons <Jeff@pcjs.org>
 *
 * This file is part of the JavaScript Machines Project (aka JSMachines) at <http://jsmachines.net/>
 * and <http://pcjs.org/>.
 *
 * JSMachines is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3
 * of the License, or (at your option) any later version.
 *
 * JSMachines is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with JSMachines.
 * If not, see <http://www.gnu.org/licenses/gpl.html>.
 *
 * You are required to include the above copyright notice in every source code file of every
 * copy or modified version of this work, and to display that copyright notice on every screen
 * that loads or runs any version of this software (see Computer.sCopyright).
 *
 * Some JSMachines files also attempt to load external resource files, such as character-image files,
 * ROM files, and disk image files. Those external resource files are not considered part of the
 * JSMachines Project for purposes of the GNU General Public License, and the author does not claim
 * any copyright as to their contents.
 */

/*
 * For complete Markdown syntax, see: http://daringfireball.net/projects/markdown/syntax
 *
 * TODO: Consider adding support for GFM-style tables, as described [here](https://help.github.com/articles/github-flavored-markdown#tables);
 * this would be nice for a Markdown-based ASCII table, for example.
 *
 * TODO: Consider adding support for GFM-style strike-through, as described [here](https://help.github.com/articles/github-flavored-markdown#strikethrough)
 *
 * TODO: Consider adding support for anything in the Markdown spec that we don't currently support (but only features that I might actually want to use).
 */

"use strict";

var path    = require("path");
var net     = require("../../shared/lib/netlib");
var proc    = require("../../shared/lib/proclib");
var str     = require("../../shared/lib/strlib");

/**
 * @class exports
 * @property {string} name
 * @property {string} version
 */
var pkg     = require("../../../package.json");

/**
 * fConsole controls diagnostic messages; it is false by default and can be overridden using the
 * setOptions() 'console' property.
 *
 * @type {boolean}
 */
var fConsole = false;

/**
 * sDefaultDir is the default directory to use with the command-line interface; it can be overridden using --dir.
 *
 * @type {string}
 */
var sDefaultDir = "/Users/Jeff/Sites/pcjs";

/**
 * sDefaultFile is the default file to use with the command-line interface; it can be overridden using --file.
 *
 * @type {string}
 */
var sDefaultFile = "./README.md";

/**
 * MarkOut()
 *
 * The req parameter is provided ONLY so that we can check for special URL parameters which, for
 * example, require us to transform standard machine configurations into DEBUG configurations.
 *
 * If aParms is provided, it should contain the following elements:
 *
 *      aParms[0]: the version to use for any machines (default is "*" for the latest version)
 *      aParms[1]: the class prefix to use for any image galleries (eg, "common-image")
 *
 * @constructor
 * @param {string} sMD containing markdown
 * @param {string|null} [sIndent] sets the overall indentation of the document
 * @param {Object} [req] is the web server's (ie, Express) request object, if any
 * @param {Array.<string>|null} [aParms] is an array of overrides to use (see below)
 * @param {boolean} [fDebug] turns on debugging features (eg, debug comments, special URL encodings, etc)
 */
function MarkOut(sMD, sIndent, req, aParms, fDebug)
{
    this.sMD = sMD;
    this.sIndent = (sIndent || "");
    this.req = req;
    this.sMachineVersion = ((aParms && aParms[0]) || "*");
    if ((this.sClassImage = ((aParms && aParms[1]) || ""))) {
        this.sClassImageGallery = this.sClassImage + "-gallery";
        this.sClassImageFrame = this.sClassImage + "-frame";
        this.sClassImageLink = this.sClassImage + "-link";
        this.sClassImageLabel = this.sClassImage + "-label";
    }
    this.fDebug = fDebug;
    this.sHTML = null;
    this.aIDs = [];         // this keeps tracks of auto-generated ID attributes for page elements, to insure uniqueness
    this.aMachines = [];    // this keeps tracks of embedded machines on the page
}

/*
 * Class constants/globals
 */

/*
 * Class methods
 */

/**
 * CLI()
 *
 * Provides a command-line interface for the markout module
 *
 * Usage:
 *
 *      markout [--dir=(directory)] [--file=(filename)] [--console=(true|false)]
 *
 * Options:
 *
 *      --dir specifies a directory to use in conjunction with --file; sDefaultDir used if none specified.
 *
 *      --file specifies an optional filename (relative to the directory given by --dir) of a markdown file;
 *      sDefaultFile is used if none specified.
 *
 *      --console turns diagnostic console messages on or off; they are OFF by default.
 *
 * Examples:
 *
 *      node modules/markout/bin/markout --file=/modules/grunts/prepjs/README.md --debug
 */
MarkOut.CLI = function()
{
    var fs = require("fs");
    var path = require("path");

    var fDebug = false;
    var args = proc.getArgs();

    if (args.argc) {
        var argv = args.argv;

        /*
         * Create a dummy Express req.query object
         */
        var req = {'query': {}};
        if (argv['debug'] !== undefined) fDebug = argv['debug'];

        MarkOut.setOptions({'console': argv['console']});

        if (fDebug) console.log("args:" + JSON.stringify(argv));

        var sDir = argv['dir'] !== undefined? argv['dir'] : sDefaultDir;
        var sFile = argv['file'] !== undefined? argv['file'] : sDefaultFile;

        sFile = path.join(sDir, sFile);
        if (fConsole) console.log("readFile(" + sFile + ")");

        fs.readFile(sFile, {encoding: "utf8"}, function(err, str) {
            if (err) {
                MarkOut.logError(err, true);
            } else {
                var m = new MarkOut(str, null, req, null, fDebug, fDebug);
                console.log(m.convertMD("    "));
            }
        });
    } else {
        console.log("usage: markout [--dir=(directory)] [--file=(filename)] [--console=(true|false)]");
    }
};

/**
 * logError(err) conditionally logs an error to the console
 *
 * @param {Error} err
 * @param {boolean} [fForce]
 * @return {string} the error message that was logged (or that would have been logged had logging been enabled)
 */
MarkOut.logError = function(err, fForce)
{
    var sError = "";
    if (err) {
        sError = "markout error: " + err.message;
        if (fConsole || fForce) console.log(sError);
    }
    return sError;
};

/**
 * setOptions(options) sets module options
 *
 * Supported options are 'console'; note that an option must be explicitly set in order to override
 * the option's default value (see fConsole).
 *
 * @param {Object} options
 */
MarkOut.setOptions = function(options)
{
    if (options['console'] !== undefined) {
        fConsole = options['console'];
    }
};

/*
 * Object methods
 */

/**
 * addMachine(infoMachine)
 *
 * The infoMachine object should contain, at a minimum:
 *
 *      {
 *          'class': sMachineClass,     // eg, "pc"
 *          'func': sMachineFunc,
 *          'id': sMachineID,
 *          'xml': sMachineXMLFile,
 *          'xsl': sMachineXSLFile,
 *          'version': sMachineVersion, // eg, "1.13.0"
 *          'debugger': fDebugger,      // eg, false
 *          'state': sMachineState
 *      }
 *
 * This is an internal function, used by convertMDMachineLinks() to record all the machines defined
 * in the current document.  getMachines() is then called externally (eg, by HTMLOut) to get this list
 * and make sure all the pre-requisites are in place (eg, CSS file and scripts in the HTML document's
 * header).
 *
 * @this {MarkOut}
 * @param {Object} infoMachine
 */
MarkOut.prototype.addMachine = function(infoMachine)
{
    this.aMachines.push(infoMachine);
};

/**
 * getMachines()
 *
 * @this {MarkOut}
 * @return {Array} of objects containing information about each machine defined by the document
 */
MarkOut.prototype.getMachines = function()
{
    return this.aMachines;
};

/**
 * generateID(sText)
 *
 * Generate an ID from the given text, by basically converting it to lower case, converting anything
 * that's not a letter or a digit to a hyphen (-), and stripping all leading and trailing hyphens from
 * the result.  Furthermore, if the generated ID is not unique (among the set of ALL generated IDs),
 * then no ID is produced.
 *
 * @this {MarkOut}
 * @param {string} sText
 * @returns {string|null} converts the given text to a unique ID (or null if resulting ID was not unique)
 */
MarkOut.prototype.generateID = function(sText)
{
    var sID = sText.replace(/[^A-Z0-9]+/gi, '-').replace(/^-+|-+$/g, "").toLowerCase();
    if (this.aIDs.indexOf(sID) < 0) {
        this.aIDs.push(sID);
        return sID;
    }
    return null;
};

MarkOut.aHTMLEntities = {
    "\\\\": "&#92;",
    "\\`":  "&#96;",
    "\\*":  "&#42;",
    "\\_":  "&#95;",
    "\\{":  "&#123;",
    "\\}":  "&#125;",
    "\\[":  "&#91;",
    "\\]":  "&#93;",
    "\\(":  "&#40;",
    "\\)":  "&#41;",
    "\\#":  "&#35;",
    "\\+":  "&#43;",
    "\\-":  "&#45;",
    "\\.":  "&#46;",
    "\\!":  "&#33;"
};

/**
 * convertMD()
 *
 * @this {MarkOut}
 * @param {string} [sIndent] sets the indentation of HTML elements within the document
 */
MarkOut.prototype.convertMD = function(sIndent)
{
    var sMD = this.sMD;

    /*
     * Convert any escaped asterisks, square brackets, etc, to their HTML-entity equivalents,
     * as a convenient way of avoiding parsing problems later.  We also take this opportunity
     * to replace any \r\n sequences with \n.
     */
    sMD = str.replaceArray(MarkOut.aHTMLEntities, sMD).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    /*
     * Before performing the original comment-elimination step, a new step has been added that
     * allows blocks of Markdown to be excluded from the Markout process (eg, build instructions
     * that you'd like to see on GitHub but that don't need to be displayed on the public website).
     *
     * Basically, you wrap those kinds of blocks with a pair of special comments, like so:
     *
     *      <!-- BEGIN:EXCLUDE --> ... <!-- END:EXCLUDE -->
     *
     * While I used upper-case for emphasis, the replacement is case-insensitive and also supports
     * triple-dash-style comments.
     */
    if (!this.fDebug) {
        sMD = sMD.replace(/[ \t]*<!--+\s*begin:exclude\s*-+->[\s\S]*?<!--+\s*end:exclude\s*-+->[\r\n]*/i, "");
    }

    /*
     * I eliminate all HTML-style comments up front, because I sometimes use such comments to
     * document Markdown-internal issues.  I've seen online references to "triple-dash" (<!--- --->)
     * comments being used for that purpose, but it doesn't seem to be a standard; however, this
     * regex should eliminate both forms.
     *
     *      $sMD = preg_replace("%<!--.*?-->%s", "", $sMD);
     *
     * NOTE: I found the following trick online: use "[\s\S]" to match any character, to work around JavaScript's
     * lack of support for the "s" (aka "dotall" or "multiline") option that changes "." to match newlines.
     */
    sMD = sMD.replace(/<!--[\s\S]*?-->/g, "");

    /*
     * Convert all lone series of three or more hyphens/underscores/asterisks into horizontal rules.
     */
    sMD = sMD.replace(/(^|\n\n+)(-\s*-\s*-+|_\s*_\s*_+|\*\s*\*\s*\*+)\s*(\n\n+|$)+/g, "$1<hr/>$3");

    /*
     * "Normalize" all series of blank lines into simple "double-linefeed" sequences
     * that we can use as markers to delineate all the top-level Markdown blocks (ie,
     * headings, paragraphs, lists, code blocks, etc).
     */
    sMD = sMD.trim().replace(/\n([ \t]*\n)+/g, "\n\n");

    /*
     * HACK: To allow paragraphs to appear within list items, I also find all lines that begin
     * with an indented list marker and are followed by a series of indented and/or blank lines,
     * and replace all double-linefeeds in that series with "\n\t\n", so that the entire series
     * will be treated as a single block.
     *
     * convertMDList() will, in turn, look for any "\n\t\n" sequences, convert them back into
     * "\n\n", and then call convertMDBlocks().
     *
     * WARNING: This hack works ONLY for lists whose list markers are indented by at least one space
     * (and up to three spaces).  This doesn't affect normal parsers, which treat all list markers
     * indented by 0-3 spaces equally.
     *
     * NOTE: I find this to be a very annoying feature of Markdown, because it's not clear to me why:
     *
     *      *   A list item.
     *
     *          With multiple paragraphs.
     *
     *      *   Another item in the list.
     *
     * should be interpreted as ONE list whose first item contains multiple paragraphs, rather than
     * as TWO lists, each with one item, and an indented code block between them.  And in fact, that's
     * exactly what I'll give you if your list markers aren't indented, per my warning above.
     *
     * The official Markdown spec (http://daringfireball.net/projects/markdown/syntax) says that if
     * you want the second paragraph to appear as a code block, it must be indented TWICE (by 8 spaces
     * or 2 tabs).  That behavior should fall out of this hack as well.
     */
    var aMatch;
    var re = /(^|\n)(  ? ?)([\*+-]|[0-9]+\.)([^\n]*\n)([ \t]+[^\n]*\n|\n)+([ \t]+[^\n]+)/g;
    //noinspection UnnecessaryLocalVariableJS
    var sMDOrig = sMD;
    while ((aMatch = re.exec(sMDOrig))) {
        var sReplace = aMatch[0].replace(/\n\n/g, "\n\t\n");
        sMD = sMD.replace(aMatch[0], sReplace);
    }

    /*
     * Ready to convert all blocks now.
     */
    sMD = this.convertMDBlocks(sMD, sIndent);

    /*
     * Post-processing hacks go here.  First off, we would like all <pre>...</pre><pre>...</pre> sequences
     * to become one single (unified) <pre> sequence.
     */
    sMD = sMD.replace(/<\/pre>(\s*)<pre>/g, "\n\n").replace(/<\/code>(\s*)<code>/g, "$1");

    this.sHTML = sMD;
    return this.sHTML;
};

/**
 * convertMDBlocks(sMD, sIndent)
 *
 * If your text may contain some block markers (ie, double-linefeeds), or headers (either "Atx-style"
 * or "Setext-style) that require the insertion of double-linefeed block markers, then call this function.
 *
 * @this {MarkOut}
 * @param {string} sMD
 * @param {string} [sIndent]
 */
MarkOut.prototype.convertMDBlocks = function(sMD, sIndent)
{
    var sHTML = "";

    /*
     * Convert all "Atx-style headers" (ie, series of leading hashmarks) to their <h#> equivalents.
     *
     * A slight tweak to standard Markdown: if there are equal numbers of hashmarks on either side of the
     * text, we center it.
     */
    sMD = sMD.replace(/(^|\n)(#+)\s+(.*?)\2(\n|$)/g, '$1<h$2 style="text-align:center">$3</h$2>\n\n');
    sMD = sMD.replace(/(^|\n)(#+)\s+(.*?)#*(\n|$)/g, "$1<h$2>$3</h$2>\n\n");

    sMD = str.replaceArray({"<h######":"<h6", "<h#####":"<h5", "<h####":"<h4", "<h###":"<h3", "<h##":"<h2", "<h#":"<h1"}, sMD);
    sMD = str.replaceArray({"h######>":"h6>", "h#####>":"h5>", "h####>":"h4>", "h###>":"h3>", "h##>":"h2>", "h#>":"h1>"}, sMD);

    /*
     * Convert all "Setext-style headers" (ie, series of equal-signs or dashes) to their <h#> equivalents.
     */
    sMD = sMD.replace(/([^\n]+)\n([=-])[=-]*(\n|$)/g, "<h$2>$1</h$2>\n\n");
    sMD = str.replaceArray({"h=>":"h1>", "h->":"h2>"}, sMD);

    /*
     * Auto-generate IDs for headings
     */
    var match;
    var re = /<(h[0-9])>([^<]*)<\/\1>/g;
    while ((match = re.exec(sMD))) {
        var sID = this.generateID(match[2]);
        if (sID) {
            sMD = sMD.replace(match[0], '<' + match[1] + ' id="' + sID + '">' + match[2] + '</' + match[1] + '>');
            /*
             * Since the replacement is guaranteed to be longer than the original, no need to worry about re.lastIndex
             */
        }
    }

    /*
     * The preceding replacements used to end with a match on "(\n|$)+", but in cases where there were consecutive
     * headings, the first match would "eat" all the linefeeds between them, and so the second heading would not get
     * matched. However, a side-effect of not "eating" all those linefeeds is that we can end up with too many of them
     * after all the heading replacements are done.
     *
     * So, even though we already "normalized" all consecutive linefeeds in convertMD(), we have to do it again
     * (although this normalization is simpler, as we don't have to worry about any other whitespace).
     */
    sMD = sMD.replace(/\n\n+/g, "\n\n");

    /*
     * Explode the given Markdown sequence into blocks based purely on double-linefeed sequences.
     */
    var asBlocks = sMD.split("\n\n");
    for (var iBlock = 0; iBlock < asBlocks.length; iBlock++) {
        sHTML += this.convertMDBlock(asBlocks[iBlock], sIndent);
    }
    return sHTML;
};

/**
 * convertMDBlock(sBlock, sIndent)
 *
 * @this {MarkOut}
 * @param {string} sBlock
 * @param {string} [sIndent]
 */
MarkOut.prototype.convertMDBlock = function(sBlock, sIndent)
{
    var sHTML = "";

    // this.addIndent(sIndent);

    // if (this.fDebug) sHTML += this.encodeComment("convertMDBlock", sBlock);

    /*
     * Look for "quoted" paragraphs that should be wrapped with <blockquote>.
     *
     * This is a recursive operation, so this code does not need to "fall into" the other conversions.
     */
    if (sBlock.match(/^>\s+/)) {
        sBlock = sBlock.replace(/(^|\n)>\s+/g, "$1");
        sHTML += this.sIndent + "<blockquote>\n" + this.convertMDBlocks(sBlock, sIndent) + this.sIndent + "</blockquote>\n";
        return sHTML;
    }

    /*
     * Look for indented paragraphs that should be converted to <pre><code> blocks.
     *
     * No other conversions should occur in such a block, so we don't "fall into" the other conversions.
     */
    var aMatch;
    var re = /^((^|\n)(    |\t)([^\n]*))+$/;
    if ((aMatch = re.exec(sBlock))) {
        var sUndented = aMatch[0].replace(/(^|\n)(    |\t)([^\n]*)/g, "$1$3");
        sBlock = sBlock.replace(aMatch[0], "<pre><code>" + str.escapeHTML(sUndented.replace(/\t/g, "    ")) + "</code></pre>");
        sHTML += this.sIndent + sBlock + "\n";
        return sHTML;
    }

    /*
     * Look for GFM ("GitHub Flavored Markdown") "fenced code blocks", which are basically code blocks
     * wrapped by "triple-backticks" instead of being indented.
     *
     * No other conversions should occur in such a block, so we don't "fall into" the other conversions.
     *
     * TODO: GFM doesn't require fenced code blocks to be preceded/followed by blank lines, so if we want
     * to support those as well, it will be up to convertMD() to detect them and parse them into discrete blocks.
     */
    re = /^```([^\n]*)\n([\s\S]*?)```$/;
    if ((aMatch = re.exec(sBlock))) {
        sBlock = sBlock.replace(aMatch[0], "<pre><code>" + str.escapeHTML(aMatch[2]) + "</code></pre>");
        sHTML += this.sIndent + sBlock + "\n";
        return sHTML;
    }

    /*
     * Convert any "double-backtick" sequences into <code> sequences, with inner backticks
     * treated as literal; we translate those to HTML entity "&#96;" to prevent them from being
     * detected as part of a "single-backtick" sequence below.
     *
     * Note that we also do the entity replacement AFTER calling htmlspecialchars(), because
     * our implementation of htmlspecialchars() isn't smart enough to avoid the "double-encoding"
     * problem (ie, translating the leading "&" of an entity into yet another "&amp;" entity).
     */
    var sBlockOrig = sBlock;
    re = /``(.*?)``/g;
    while ((aMatch = re.exec(sBlockOrig))) {
        sBlock = sBlock.replace(aMatch[0], "<code>" + str.escapeHTML(aMatch[1]).replace(/`/g, "&#96;") + "</code>");
    }

    /*
     * Convert any remaining "single-backtick" sequences into <code> sequences as well.
     */
    sBlockOrig = sBlock;
    re = /`(.*?)`/g;
    while ((aMatch = re.exec(sBlockOrig))) {
        sBlock = sBlock.replace(aMatch[0], "<code>" + str.escapeHTML(aMatch[1]) + "</code>");
    }

    /*
     * Per markdown syntax: "When you do want to insert a <br /> break tag using Markdown,
     * you end a line with two or more spaces, then type return."
     */
    sBlock = sBlock.replace(/  +\n/g, "<br/>\n" + this.sIndent);

    /*
     * If the block looks like a list, convertMDList() will convert it; if not, then it will wrap the
     * block with paragraph tags -- assuming the block isn't already wrapped with some sort of block markup.
     */
    sBlock = this.convertMDList(sBlock, sIndent);

    /*
     * Process any "image" Markdown links first (since they can be misinterpreted as "normal" links);
     * this ordering also allows image links to be wrapped by "normal" Markdown links, if you want to
     * turn images into links, as in:
     *
     *      [![Alt text](http://www.google.com.au/images/nav_logo7.png)](http://google.com.au/)
     *
     * However, we also offer a "link:" extension to the title attribute; as in:
     *
     *      ![Alt text](http://www.google.com.au/images/nav_logo7.png "link:http://google.com.au/")
     *
     * which has the same effect but ALSO wraps the image in a special "image link" class and displays the
     * "Alt text" as a label underneath the image; and if the block consists entirely of such images, then all
     * the images are wrapped in an "image gallery" class.
     */
    sBlock = this.convertMDImageLinks(sBlock, sIndent);

    /*
     * Process any special "machine" Markdown-style links next.
     */
    sBlock = this.convertMDMachineLinks(sBlock);

    /*
     * Now we can finally process "normal" Markdown links.
     */
    sBlock = this.convertMDLinks(sBlock);

    /*
     * Finally, look for all assorted forms of Markdown emphasis (there's no particular reason we do it last, we just do).
     */
    sBlock = this.convertMDEmphasis(sBlock);

    sHTML += this.sIndent + sBlock + "\n";

    // this.subIndent(sIndent);

    return sHTML;
};

/**
 * convertMDList(sBlock, sIndent)
 *
 * If the block begins with an unordered list marker, create an unordered list;
 * similarly, if the block begins with an ordered list marker, create an ordered list.
 *
 * Otherwise, wrap the block with paragraph tags in the absence of any other block markup.
 *
 * HACK: To allow paragraphs to appear within list items, convertMD() found all lines that
 * began with an indented list marker and were followed by a series of indented and/or  blank
 * lines, and replaced all double-linefeeds in that series with "\n\t\n".  Hence, this
 * function must compensate by replacing "\n\t\n" sequences in any sub-lists with the normal
 * "\n\n" and calling convertMDBlocks().
 *
 * FEATURE: If you use "*" as your unordered list marker (instead of "+" or "-", all of which
 * Markdown apparently treats equivalently), I automatically use a list style that omits bullets.
 * So, if you REALLY want bullets, use "-" or "+".
 *
 * @this {MarkOut}
 * @param {string} sBlock
 * @param {string} sIndent
 * @return {string}
 */
MarkOut.prototype.convertMDList = function(sBlock, sIndent)
{
    var sIndentPrev = this.addIndent(sIndent);

    var aMatch;
    var aMatches = [];
    var re = /(^|\n) ? ? ?([\*+-]|[0-9]+\.)[ \t]+/g;
    while ((aMatch = re.exec(sBlock))) {
        aMatches.push(aMatch);
    }
    if (aMatches.length && aMatches[0].index === 0) {
        aMatch = aMatches[0];
        var sListType = aMatch[2].charAt(0);
        var sListStyle = "md-list" + (sListType == '*'? " md-list-none" : (sListType == '-'? " md-list-compact" : ""));
        sListType = (sListType >= '0' && sListType <= '9')? "ol" : "ul";
        var sList = '<' + sListType + ' class="' + sListStyle + '">\n';

        for (var iMatch = 0; iMatch < aMatches.length; iMatch++) {
            aMatch = aMatches[iMatch];
            var iStart = aMatch.index + aMatch[0].length;
            var iStop = iMatch < aMatches.length-1? aMatches[iMatch+1].index : sBlock.length;
            var sListItem = sBlock.substr(iStart, iStop - iStart);
            /*
             * If this list item contains one or more lines indented by 4 or more spaces (or 1 or more tabs)
             * then we need to strip them, so that they can be parsed as a sub-list.
             */
            re = /((^|\n)(    |\t)([^\n]*))+/;
            if ((aMatch = re.exec(sListItem))) {
                // if (this.fDebug) sList += this.encodeComment("subList", aMatch[0]);
                var sSubList = aMatch[0].replace(/(^|\n)(    |\t)([^\n]*)/g, "$1$3").replace(/\n\t\n/g, "\n\n");
                if (sSubList.charAt(0) == "\n") sSubList = sSubList.substr(1);
                sListItem = str.replaceAll(aMatch[0], "\n" + this.sIndent + this.convertMDBlocks(sSubList, sIndent).trim() + "\n" + this.sIndent, sListItem);
            } else {
                sListItem = this.convertMDLines(sListItem);
            }
            sList += this.sIndent + "<li>" + sListItem + "</li>\n";
        }
        sList += sIndentPrev + "</" + sListType + ">";
        sBlock = sList;
    }
    else {
        /*
         * In the absence of any other block markup, wrap the block in paragraph tags.
         *
         * TODO: The test here is currently for *any* HTML markup; this should probably be tightened up.
         */
        if (sBlock.charAt(0) != "<") sBlock = "<p>" + this.convertMDLines(sBlock) + "</p>";
    }
    this.subIndent(sIndent);
    return sBlock;
};

/**
 * convertMDLines(s)
 *
 * This function is purely cosmetic.  The intent is to indent all the lines in multi-line items
 * (eg, paragraphs, list items), so that the resulting HTML is a bit more readable.  Unfortunately,
 * it has some unintended side-effects (for example, it creates unnecessary indentation inside image
 * galleries, which are nothing more than paragraphs containing a series of image links), so this
 * code is disabled for now.
 *
 * @this {MarkOut}
 * @param {string} s
 * @return {string}
 */
MarkOut.prototype.convertMDLines = function(s)
{
    return s;
    // return s.replace(/\n/g, "\n" + this.sIndent).trim();
};

/**
 * convertMDLinks(sBlock)
 *
 * Aside from basic "inline" Markdown links, we also support named anchors; if the link begins with '#',
 * we strip the '#' and use the remainder of the link as the name of the anchor.  To reference a named
 * anchor from another link, you have to specify a path with '#' and the anchor name appended, in order
 * to distinguish an anchor name from an anchor reference.
 *
 * Note that the need for named anchors is somewhat diminished now that I automatically generate IDs for
 * all heading tags (eg, <h1>); refer to the generateID() function that's used in convertMDBlocks().
 *
 * Another extension to Markdown that I've added is detecting empty parentheses alongside a likely URL,
 * and automatically converting it to a link; eg:
 *
 *      [http://www.ascii-code.com/]()
 *
 * Also, if a URL contains any asterisks, we replace them with the current version number from "package.json".
 *
 * I prefer this solution over GFM's "autolinking" solution, which is too "loosey-goosey" for my taste
 * (see https://help.github.com/articles/github-flavored-markdown#url-autolinking).
 *
 * TODO: Consider adding support for "reference"-style Markdown links.
 *
 * @this {MarkOut}
 * @param {string} sBlock
 * @return {string}
 */
MarkOut.prototype.convertMDLinks = function(sBlock)
{
    var aMatch;
    var re = /\[([^\[\]]*)\]\((.*?)(?:\s*"(.*?)"\)|\))/g;
    while ((aMatch = re.exec(sBlock))) {
        var sTag = "a";
        var sType = "href";
        var sText = aMatch[1];
        var sURL = aMatch[2];
        var sTitle = (aMatch[3]? ' title="' + aMatch[3] + '"' : '');
        if (!sURL) {            // if the parentheses are empty and the text (kinda) looks like a URL, use the text as the URL, too
            if (sText.match(/^[a-z]+:/) || sText.match(/^\/(.*)\/$/)) {
                sURL = sText;
            } else if (sText.match(/(^www\.|\.com|\.org|\.net|\.io)/)) {
                sURL = "http://" + sText;
            } else if (sText.indexOf(' ') < 0 && sText.indexOf('.') > 0) {
                sURL = sText;   // we assume you're trying to automatically link to a filename
            }
        }
        sURL = sURL.replace(/\*/g, pkg.version);
        if (sURL.charAt(0) == '#') {
            sTag = "span";      // using <a> to name an anchor is deprecated
            sType = "id";       // using the "name" attribute is deprecated as well
            sURL = sURL.substr(1);
        } else {
            sURL = net.encodeURL(sURL, this.req, this.fDebug);
        }
        sBlock = str.replaceAll(aMatch[0], '<' + sTag +  ' ' + sType + '="' + sURL + '"' + sTitle + '>' + sText + '</' + sTag + '>', sBlock);
    }
    return sBlock;
};

/**
 * convertMDImageLinks(sBlock)
 *
 * @this {MarkOut}
 * @param {string} sBlock
 * @param {string} sIndent
 * @return {string}
 */
MarkOut.prototype.convertMDImageLinks = function(sBlock, sIndent)
{
    /*
     * Look for image links of the form ![...](...) and convert them.  We do this before processing non-image
     * ("normal") links, since the only difference in syntax is the presence of a preceding exclamation point (!).
     *
     * We also extend the syntax a bit, by allowing the optional title string inside the parentheses to include
     * a special "link:" prefix; if that prefix is present, we will wrap the image with the URL following that prefix,
     * and then wrap THAT with the special image classes, if any, that we were given at initialization.
     */
    var aMatch;
    var cImageLinks = 0;
    var fNoGallery = false;
    var sBlockOrig = sBlock;
    var re = /!\[(.*?)\]\((.*?)(?:\s*"(.*?)"\)|\))/g;
    while ((aMatch = re.exec(sBlockOrig))) {
        var sImage = '<img src="' + net.encodeURL(aMatch[2], this.req, this.fDebug) + '" alt="' + aMatch[1] + '"';
        if (aMatch[3]) {
            /*
             * The format of the special "link:" syntax is:
             *
             *      link:url[:width[:height]]
             *
             * If "link:" is specified, a URL is required, but image width and height are optional.
             *
             * Alternatively:
             *
             *      link:url:nogallery[:width[:height]]
             *
             * to disable the automatic "gallery-ification" of image links (an optional width and height
             * can still follow).
             */
            var iPart = 0;
            var asParts = aMatch[3].split(':');
            if (asParts[iPart++] == "link") {
                var sURL = asParts[iPart++];
                if ((sURL == "http" || sURL == "https" || sURL == "ftp") && asParts[iPart]) {
                    sURL += ':' + asParts[iPart];
                    asParts.splice(2, 1);
                }
                /*
                 * If the image link (aMatch[2]) contains "static/" but the sURL is external, AND we're in
                 * "reveal mode", then transform sURL into a "static/" URL as well; encodeURL() will take care
                 * of the rest of the transformation.
                 *
                 * This feature is used with READMEs like /pubs/pc/programming/README.md, where normally we
                 * want to link to documents stored on sites like archive.org, minuszerodegrees.net or bitsavers,
                 * unless you're in "reveal mode", in which case we'll serve up our own "backup copies".
                 *
                 * The assumption here is that if we have "static" thumbs, then we should also have full "static"
                 * copies as well.
                 */
                if (aMatch[2].indexOf("static/") >= 0 && sURL.indexOf("://") > 0 && (this.fDebug || net.hasParm(net.REVEAL_COMMAND, net.REVEAL_PDFS, this.req))) {
                    sURL = aMatch[2].replace("/thumbs/", "/").replace(" 1.jpeg", ".pdf").replace(".jpg", ".pdf");
                }
                sURL = net.encodeURL(sURL, this.req, this.fDebug);
                if (asParts[iPart] == "nogallery") {
                    fNoGallery = true;
                    iPart++;
                }
                this.addIndent(sIndent);
                var sID = this.generateID(aMatch[1]);
                sID = (sID? (' id="' + sID + '"') : "");
                var sImageLink = this.sIndent + '<div' + sID + ' class="' + this.sClassImageFrame + '">\n';
                this.addIndent(sIndent);
                sImageLink += this.sIndent + '<div class="' + this.sClassImageLink + '">\n';
                this.addIndent(sIndent);
                sImageLink += this.sIndent + (sURL? '<a href="' + sURL + '">' : '') + sImage;
                if (asParts[iPart]) {
                    sImageLink += ' width="' + asParts[iPart++] + '"';
                }
                if (asParts[iPart]) {
                    sImageLink += ' height="' + asParts[iPart++] + '"';
                }
                sImageLink += "/>" + (sURL? "</a>" : "");
                this.subIndent(sIndent);
                sImageLink += this.sIndent + '</div>\n';
                sImageLink += this.sIndent + '<span class="' + this.sClassImageLabel + '">' + aMatch[1] + '</span>\n';
                this.subIndent(sIndent);
                sImageLink += this.sIndent + '</div>';
                this.subIndent(sIndent);
                sImage = sImageLink;
                cImageLinks++;
            } else {
                sImage += ' title="' + aMatch[3] + '"/>';
            }
        } else {
            sImage += '/>';
        }
        sBlock = sBlock.replace(aMatch[0], sImage);
    }
    if (cImageLinks && !fNoGallery) {
        sBlock = sBlock.replace(/^<p>([\s\S]*)<\/p>$/g, '<div class="' + this.sClassImageGallery + '">\n$1\n' + this.sIndent + '</div>');
    }
    return sBlock;
};

/**
 * convertMDMachineLinks(sBlock)
 *
 * @this {MarkOut}
 * @param {string} sBlock
 * @return {string}
 */
MarkOut.prototype.convertMDMachineLinks = function(sBlock)
{
    /*
     * Before we call convertMDLinks() to process any normal Markdown-style links, we first
     * look for our own special flavor of "machine" Markdown links; ie:
     *
     *      [IBM PC](/devices/pc/machine/5150/mda/64kb/ "PCjs:demoPC:stylesheet:version:options:state")
     *
     * where a special title attribute triggers generation of an embedded machine rather than
     * a link.  Use "PCjs" or "C1Pjs" to automatically include the latest version of either
     * "pc.js" or "c1p.js", followed by a colon and the ID you want to use for the embedded <div>.
     * If you need to use the script with the built-in Debugger (ie, either "pc-dbg.js" or
     * "c1p-dbg.js"), then include "debugger" in the list of comma-delimited options, as in:
     *
     *      [IBM PC](/devices/pc/machine/5150/mda/64kb/ "PCjs:demoPC:::debugger")
     *
     * If the link ends with a slash, then it's an implied reference to a "machine.xml".
     *
     * Granted, there are a number of things we could be smarter about.  First, you probably
     * don't care about the ID for the <div>; it's purely a mechanism for telling the script
     * where to embed the machine, so we could auto-generate an ID for you, but on the other hand,
     * there might actually be situations where you want to style the machine a certain way, or
     * interact with it from another script, so having a known ID can be a good thing.
     *
     * Second, if we know we're running on the same server as the machine XML file in the link,
     * we could crack that file open right now, see if it includes a <debugger>, and automatically
     * include the appropriate script, without requiring the user to specify that.  And in fact,
     * that's exactly what the "machine.xsl" stylesheet does: it calls componentScripts() with the
     * appropriate script based on the presence of a <debugger> element in the XML file.  That's
     * similar to what getMachineXML() in htmlout.js does, when it's loading a "machine.xml".
     *
     * We don't have the XML file open here, and I don't think it's worth the hit to open it.
     * Besides, the XML config file isn't necessarily on the same server (although whenever this
     * script is being used, it very likely is).
     *
     * TODO: Consider cracking open the XML file anyway, even though the Markdown module is supposed
     * to be non-blocking; I'd like to be smarter about defaults (eg, specifying "debugger" when the
     * XML file clearly needs it).
     */
    var aMatch;
    var cMatches = 0;
    var reMachines = /\[(.*?)\]\((.*?)\s*"(PC|C1P)js:(.*?)"\)/gi;

    while ((aMatch = reMachines.exec(sBlock))) {

        var sMachineXMLFile = aMatch[2];
        if (sMachineXMLFile.slice(-1) == "/") sMachineXMLFile += "machine.xml";

        var sMachine = aMatch[3].toUpperCase();
        var sMachineFunc = "embed" + sMachine;
        var sMachineClass = sMachine.toLowerCase();
        var aMachineParms = aMatch[4].split(':');
        var sMachineMessage = "Waiting for " + sMachine + "js to load";

        var sMachineID = aMachineParms[0];
        var sMachineXSLFile = aMachineParms[1] || "";
        var sMachineVersion = aMachineParms[2] || this.sMachineVersion;
        var sMachineOptions = aMachineParms[3] || "";
        var sMachineState = aMachineParms[4] || "";
        var aMachineOptions = sMachineOptions.split(',');
        var fDebugger = (aMachineOptions.indexOf("debugger") >= 0);

        /*
         * TODO: Consider validating the existence of this XML file and generating a more meaningful error if not found
         */
        var sReplacement = '<div id="' + sMachineID + '" class="machine-placeholder"><p>' + aMatch[1] + '</p><p class="machine-warning">' + sMachineMessage + '</p></div>\n';

        /*
         * The embedPC()/embedC1P functions take an XSL file as the 3rd parameter, which defaults to:
         *
         *      "/versions/" + APPCLASS + "/" + APPVERSION + "/components.xsl"
         *
         * However, when debugging, I'd prefer to use the "development" version of components.xsl, rather than the default
         * "production" version.
         */
        if (!sMachineXSLFile || sMachineXSLFile.indexOf("components.xsl") >= 0) {
            if (this.fDebug) {
                sMachineXSLFile = "/modules/" + sMachineClass + "js/templates/components.xsl";
            }
        }

        /*
         * Now that we're providing all of the following machine information to addMachine(), we don't
         * need to install the machine embed code here; processMachines() in HTMLOut will take care of that now.
         *
        sReplacement += this.sIndent + '<script type="text/javascript">\n' + this.sIndent + 'window.' + sMachineFunc + '("' + sMachineID + '","' + sMachineXMLFile + '","' + sMachineXSLFile + '");\n' + this.sIndent + '</script>';
         */

        sBlock = sBlock.replace(aMatch[0], sReplacement);
        reMachines.lastIndex = 0;       // reset lastIndex, since we just modified the string that reMachines is iterating over
        cMatches++;

        this.addMachine({
            'class': sMachineClass,
            'func': sMachineFunc,
            'id': sMachineID,
            'xml': sMachineXMLFile,
            'xsl': sMachineXSLFile,
            'version': sMachineVersion,
            'debugger': fDebugger,
            'state': sMachineState}
        );
    }

    if (cMatches) {
        sBlock = sBlock.replace(/^<p>([\s\S]*)<\/p>$/g, "$1");
    }

    return sBlock;
};

/**
 * convertMDEmphasis(sBlock)
 *
 * We look for sequences like **strength**, __strength__, *emphasis* and _emphasis_;
 * we convert the stronger (double-character) forms first, followed by the weaker
 * (single-character) forms, since we don't want to misconstrue the former as containing
 * the latter.
 *
 * Also, standard Markdown says that "if you surround an * or _ with spaces, it’ll be
 * treated as a literal asterisk or underscore."  Well, we don't.  You can already escape
 * special characters with a backslash to make them literal, so I don't feel like
 * complicating the RegExps below to accommodate a syntax I don't use or want to support.
 *
 * Also, for reasons noted in the code below, we don't support emphasis in the middle
 * of words.
 *
 * @this {MarkOut}
 * @param {string} sBlock
 * @return {string}
 */
MarkOut.prototype.convertMDEmphasis = function(sBlock)
{
    /*
     * Standard Markdown allows * or _ in the middle of a word, as in:
     *
     *      un*frigging*believable
     *
     * but we do not.  That's because a Markdown link like:
     *
     *      [modules](/modules/)
     *
     * would otherwise be misconstrued as containing emphasis (and it doesn't
     * matter whether we process emphasis BEFORE or AFTER links -- an HTML link
     * poses the same problem as a Markdown link).
     *
     * To resolve this, I require something non-alphanumeric to both precede AND
     * follow the emphasis characters.  I would expect that "something" to normally
     * be whitespace, but we make it a bit more flexible, so that you can do things
     * like place emphasis INSIDE links:
     *
     *      [*modules*](/modules/)
     *
     * or OUTSIDE links:
     *
     *      *[modules](/modules/)*
     */
    if (sBlock.indexOf('*') >= 0 || sBlock.indexOf('_') >= 0) {
        sBlock = sBlock.replace(/(^|[^a-z0-9])([\*_])\2([\s\S]*?)\2\2([^a-z0-9]|$)/gi, "$1<strong>$3</strong>$4");
        sBlock = sBlock.replace(/(^|[^a-z0-9])([\*_])([\s\S]*?)\2([^a-z0-9]|$)/gi, "$1<em>$3</em>$4");
    }
    return sBlock;
};

/**
 * addIndent(sIndent)
 *
 * @this {MarkOut}
 * @param {string|undefined} sIndent
 * @return {string} previous indent
 */
MarkOut.prototype.addIndent = function(sIndent)
{
    var sIndentPrev = this.sIndent;
    this.sIndent += (sIndent || "");
    return sIndentPrev;
};

/**
 * subIndent(sIndent)
 *
 * @this {MarkOut}
 * @param {string|undefined} sIndent
 */
MarkOut.prototype.subIndent = function(sIndent)
{
    if (sIndent) {
        var cch = this.sIndent.length - sIndent.length;
        if (cch < 0) {
            MarkOut.logError(new Error("indentation underflow"), true);
            cch = 0;
        }
        this.sIndent = this.sIndent.substr(0, cch);
    }
};

/**
 * encodeComment(sLabel, sText)
 *
 * This is used purely (at the moment) for debugging purposes, so that we can clearly see
 * what our simplistic Markdown parser is parsing at each stage.
 *
 * @this {MarkOut}
 * @param {string} sLabel
 * @param {string} sText
 * @return {string}
 *
MarkOut.prototype.encodeComment = function(sLabel, sText)
{
    return '<!-- ' + sLabel + '("' + this.encodeWhitespace(sText) + '") -->\n';
};
 */

/**
 * encodeWhitespace(sText)
 *
 * This is used purely (at the moment) for debugging purposes, so that we can clearly see
 * what our simplistic Markdown parser is parsing at each stage.
 *
 * @this {MarkOut}
 * @param {string} sText
 * @return {string}
 *
MarkOut.prototype.encodeWhitespace = function(sText)
{
    return str.replaceArray({" ":".", "\t":"\\t", "\n":"\\n"}, sText);
};
 */

module.exports = MarkOut;
