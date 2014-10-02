/**
 * @fileoverview This file implements the C1Pjs ROM component.
 * @author <a href="mailto:Jeff@pcjs.org">Jeff Parsons</a>
 * @version 1.0
 * @suppress {missingProperties}
 * Created 2012-Jun-15
 *
 * Copyright © 2012-2014 Jeff Parsons <Jeff@pcjs.org>
 *
 * This file is part of C1Pjs, which is part of the JavaScript Machines Project (aka JSMachines)
 * at <http://jsmachines.net/> and <http://pcjs.org/>.
 *
 * C1Pjs is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3
 * of the License, or (at your option) any later version.
 *
 * C1Pjs is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with C1Pjs.  If not,
 * see <http://www.gnu.org/licenses/gpl.html>.
 *
 * You are required to include the above copyright notice in every source code file of every
 * copy or modified version of this work, and to display that copyright notice on every screen
 * that loads or runs any version of this software (see Computer.sCopyright).
 *
 * Some C1Pjs files also attempt to load external resource files, such as character-image files,
 * ROM files, and disk image files. Those external resource files are not considered part of the
 * C1Pjs program for purposes of the GNU General Public License, and the author does not claim
 * any copyright as to their contents.
 */

"use strict";

/**
 * C1PROM(parmsROM)
 *
 * The ROM component expects the following (parmsROM) properties:
 *
 *      size: amount of ROM, in bytes
 *      image: name of ROM image file
 *
 * NOTE: The final location for the ROM image, once loaded, will be specified
 * by the Computer object, using the setBuffer() method.
 *
 * @constructor
 * @extends Component
 * @property {function()} convertImage
 */
function C1PROM(parmsROM)
{
    Component.call(this, "C1PROM", parmsROM);
    this.abMem = null;
    this.abImage = null;
    this.cbROM = parmsROM['size'];
    this.sImage = parmsROM['image'];
    if (this.sImage) {
        var sFileURL = this.sImage;
        /**
         * If the selected ROM image has a ".json" extension, then we assume it's a pre-converted
         * JSON-encoded ROM image, so we load it as-is; ditto for files with a ".hex" extension. Otherwise,
         * we ask our server-side ROM image converter to return the corresponding JSON-encoded data,
         * in compact form (ie, minimal whitespace, no ASCII data comments, etc).
         */
        var sFileExt = str.getExtension(this.sImage); 
        if (sFileExt != "json" && sFileExt != "hex") {
            /**
             * TODO: This code was using a deprecated parameter (compact=1); make sure things still work.
             * 
             * TODO: Convert this code to use the new shared File API definitions and weblib functions; eg:
             * 
             *      sFileURL = web.getHost() + DumpAPI.ENDPOINT + "?" + DumpAPI.QUERY.FILE + "=" + this.sImage;
             */
            sFileURL = "http://" + window.location.host + "/api/v1/dump?file=" + this.sImage;
        }
        web.loadResource(sFileURL, true, null, this, this.convertImage);
    }
}

Component.subclass(Component, C1PROM);

/**
 * @this {C1PROM}
 * @param {Array} abMemory
 * @param {number} start
 * @param {number} end
 * @param {C1PCPU} cpu
 */
C1PROM.prototype.setBuffer = function(abMemory, start, end, cpu)
{
    this.abMem = abMemory;
    this.offROM = start;
    var cbROM = end - start + 1;
    /*
     * It's possible that the ROM component didn't specify a size,
     * in which case just use the size the Computer component has specified.
     */
    if (!this.cbROM)
        this.cbROM = cbROM;
    if (cbROM != this.cbROM) {
        this.setError("computer-specified ROM size (" + str.toHexWord(cbROM) + ") does not match component-specified size (" + str.toHexWord(this.cbROM) + ")");
        return;
    }
    if (cpu) {
        this.cpu = cpu;
        cpu.addWriteNotify(start, end, this, this.setByte);
    }
    this.copyImage();
};

/**
 * @this {C1PROM}
 * @param {boolean} fOn
 * @param {C1PComputer} cmp
 */
C1PROM.prototype.setPower = function(fOn, cmp)
{
    if (fOn && !this.fPower) {
        this.fPower = true;
        if (DEBUGGER) this.dbg = cmp.getComponentByType("debugger");
    }
};

/**
 * @this {C1PROM}
 * @param {number} addr
 * @param {number|undefined} [addrFrom]
 */
C1PROM.prototype.setByte = function(addr, addrFrom)
{
    /*
     * Beyond reporting this write, we need to "repair" the ROM, using the original image data,
     * but only if addrFrom is defined (undefined implies this is a write from the Debugger, and
     * we need to allow the Debugger to modify ROM contents).
     */
    if (addrFrom !== undefined) {
        if (DEBUGGER && this.dbg) this.dbg.messagePort(this, addr, addrFrom, this.dbg.MESSAGE_PORT, true);
        var offset = (addr - this.offROM);
        Component.assert(offset >= 0 && offset < this.cbROM);
        if (!this.abImage)
            this.abMem[this.offROM + offset] = 0;
        else
            this.abMem[this.offROM + offset] = this.abImage[offset];
    }
};

/**
 * @this {C1PROM}
 * @param {string} sImageName
 * @param {string} sImageData
 * @param {number} nErrorCode (response from server if anything other than 200)
 */
C1PROM.prototype.convertImage = function(sImageName, sImageData, nErrorCode)
{
    if (nErrorCode) {
        this.println("ROM load error (" + nErrorCode + ")");
        return;
    }
    if (sImageData[0] == "[") {
        try {
            /*
             * The most likely source of any exception will be right here, where we're parsing
             * the JSON-encoded ROM data.
             */
            this.abImage = eval("(" + sImageData + ")");
        } catch (e) {
            //
            // System exceptions throw an object with a message property, whereas exceptions I throw myself do not (they're just strings)
            //
            this.println("ROM data error: " + (e.message || e));
            return;
        }
    }
    else {
        /*
         * Parse the ROM image data manually; we assume it's in "simplified" hex form (a series of hex byte-values separated by whitespace)
         */
        var sData = sImageData.replace(/\n/gm, " ").replace(/ +$/, "");
        var asData = sData.split(" ");
        this.abImage = new Array(asData.length);
        for (var i=0; i < asData.length; i++) {
            this.abImage[i] = parseInt(asData[i], 16);
        }
    }
    this.copyImage();
};

/**
 * @this {C1PROM}
 */
C1PROM.prototype.copyImage = function()
{
    /*
     * The Computer object may give us the address of the ROM image before we've finished downloading the image, 
     * so both setBuffer() and convertImage() call copyImage(), which in turn will copy the image ONLY when both
     * pieces are in place.  At that point, the component becomes "ready", in much the same way that other components
     * (eg, CPU and Screen) become "ready" when all their prerequisites are satisfied.
     */
    if (!this.isReady()) {
        if (!this.sImage) {
            this.setReady();
        }
        else
        if (this.abImage && this.abMem) {
            var cbImage = this.abImage.length;
            if (cbImage != this.cbROM) {
                this.setError("ROM image size (" + str.toHexWord(cbImage) + ") does not match component-specified size (" + str.toHexWord(this.cbROM) + ")");
                return;
            }
            if (DEBUG) this.log("copyImage(): copying ROM to " + str.toHexAddr(this.offROM) + " (0x" + str.toHexWord(cbImage) + " bytes)");
            for (var i=0; i < cbImage; i++) {
                this.abMem[this.offROM + i] = this.abImage[i];
            }
            this.setReady();
        }
    }
};

/**
 * C1PROM.init()
 *
 * This function operates on every element (e) of class "rom", and initializes
 * all the necessary HTML to construct the ROM module(s) as spec'ed.
 *
 * Note that each element (e) of class "rom" is expected to have a "data-value"
 * attribute containing the same JSON-encoded parameters that the ROM constructor
 * expects.
 */
C1PROM.init = function()
{
    var aeROM = Component.getElementsByClass(window.document, C1PJSCLASS, "rom");
    for (var iROM=0; iROM < aeROM.length; iROM++) {
        var eROM = aeROM[iROM];
        var parmsROM = Component.getComponentParms(eROM);
        var rom = new C1PROM(parmsROM);
        Component.bindComponentControls(rom, eROM, C1PJSCLASS);
    }
};

/*
 * Initialize all the ROM modules on the page.
 */
web.onInit(C1PROM.init);