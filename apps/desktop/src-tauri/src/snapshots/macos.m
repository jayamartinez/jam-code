#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <ImageIO/ImageIO.h>
#import <Carbon/Carbon.h>

typedef void (*KeyCallback)(int, uint64_t);
typedef void (*CaptureCallback)(uint64_t, const char *);
static CFMachPortRef tap;
static CFRunLoopSourceRef tapSource;
static KeyCallback keyCallback;

static CGEventRef onKey(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *info) {
    (void)proxy; (void)info;
    if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
        if (keyCallback) keyCallback(3, 0);
        if (tap) CGEventTapEnable(tap, true);
        return event;
    }
    int kind = 3;
    CGEventFlags flags = CGEventGetFlags(event);
    int64_t code = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
    if (type == kCGEventFlagsChanged && (code == 56 || code == 60) &&
        !(flags & (kCGEventFlagMaskCommand | kCGEventFlagMaskControl | kCGEventFlagMaskAlternate | kCGEventFlagMaskSecondaryFn | kCGEventFlagMaskAlphaShift))) {
        kind = (flags & kCGEventFlagMaskShift) ? 1 : 2;
    }
    if (keyCallback) keyCallback(kind, CGEventGetTimestamp(event) / 1000000);
    return event; // Listen-only: never suppress or replace user input.
}
void jam_snapshot_stop(void) {
    if (tapSource) { CFRunLoopRemoveSource(CFRunLoopGetMain(), tapSource, kCFRunLoopCommonModes); CFRelease(tapSource); tapSource=NULL; }
    if (tap) { CGEventTapEnable(tap,false); CFMachPortInvalidate(tap); CFRelease(tap); tap=NULL; }
    keyCallback=NULL;
}
int jam_snapshot_start(KeyCallback callback) {
    jam_snapshot_stop();
    if (!CGPreflightListenEventAccess()) return 1;
    CGEventMask mask=CGEventMaskBit(kCGEventFlagsChanged)|CGEventMaskBit(kCGEventKeyDown)|CGEventMaskBit(kCGEventKeyUp)|CGEventMaskBit(kCGEventLeftMouseDown)|CGEventMaskBit(kCGEventRightMouseDown)|CGEventMaskBit(kCGEventOtherMouseDown)|CGEventMaskBit(kCGEventScrollWheel);
    tap=CGEventTapCreate(kCGSessionEventTap,kCGTailAppendEventTap,kCGEventTapOptionListenOnly,mask,onKey,NULL);
    if (!tap) return 2;
    keyCallback=callback;
    tapSource=CFMachPortCreateRunLoopSource(kCFAllocatorDefault,tap,0);
    CFRunLoopAddSource(CFRunLoopGetMain(),tapSource,kCFRunLoopCommonModes);
    CGEventTapEnable(tap,true);
    return 0;
}
void jam_snapshot_permissions(void) {
    CGRequestListenEventAccess();
    CGRequestScreenCaptureAccess();
}
static void reply(CaptureCallback callback,uint64_t token,NSDictionary *data) {
    NSData *json=[NSJSONSerialization dataWithJSONObject:data options:0 error:nil];
    NSString *string=[[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    callback(token,string.UTF8String);
}
static NSData *jpeg(CGImageRef image, NSUInteger width, NSUInteger height, double quality) {
    CGColorSpaceRef color=CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef ctx=CGBitmapContextCreate(NULL,width,height,8,width*4,color,(CGBitmapInfo)kCGImageAlphaNoneSkipLast);
    CGColorSpaceRelease(color);
    if (!ctx) return nil;
    CGContextSetInterpolationQuality(ctx,kCGInterpolationHigh);
    CGContextDrawImage(ctx,CGRectMake(0,0,width,height),image);
    CGImageRef resized=CGBitmapContextCreateImage(ctx); CGContextRelease(ctx);
    NSMutableData *data=[NSMutableData data];
    CGImageDestinationRef destination=CGImageDestinationCreateWithData((__bridge CFMutableDataRef)data,CFSTR("public.jpeg"),1,NULL);
    CGImageDestinationAddImage(destination,resized,(__bridge CFDictionaryRef)@{(__bridge NSString *)kCGImageDestinationLossyCompressionQuality:@(quality)});
    BOOL ok=CGImageDestinationFinalize(destination); CFRelease(destination); CGImageRelease(resized);
    return ok ? data : nil;
}
void jam_snapshot_capture(uint64_t token,CaptureCallback callback) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!CGPreflightScreenCaptureAccess()) { reply(callback,token,@{@"error":@"Allow Screen Recording for JAM in System Settings, then retry."}); return; }
        if (@available(macOS 14.0, *)) {
            NSRunningApplication *front=NSWorkspace.sharedWorkspace.frontmostApplication;
            pid_t pid=front.processIdentifier;
            NSArray *windows=CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly|kCGWindowListExcludeDesktopElements,kCGNullWindowID));
            NSNumber *windowID=nil;
            for (NSDictionary *info in windows) {
                if ([info[(id)kCGWindowOwnerPID] intValue]==pid && [info[(id)kCGWindowLayer] intValue]==0 && [info[(id)kCGWindowAlpha] doubleValue]>0) { windowID=info[(id)kCGWindowNumber]; break; }
            }
            if (!windowID) { reply(callback,token,@{@"error":@"No capturable active application window."}); return; }
            NSString *application=front.localizedName ?: @"Application";
            [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *content,NSError *error) {
                SCWindow *target=nil;
                for (SCWindow *window in content.windows) { if (window.windowID==windowID.unsignedIntValue) { target=window; break; } }
                if (!target || error) { reply(callback,token,@{@"error":@"The active window is no longer available or capture permission was denied."}); return; }
                SCContentFilter *filter=[[SCContentFilter alloc] initWithDesktopIndependentWindow:target];
                SCStreamConfiguration *config=[SCStreamConfiguration new];
                double scale=MIN(filter.pointPixelScale,4096.0/MAX(target.frame.size.width,target.frame.size.height));
                config.width=MAX(1,(NSUInteger)(target.frame.size.width*scale));
                config.height=MAX(1,(NSUInteger)(target.frame.size.height*scale));
                config.showsCursor=NO; config.ignoreShadowsSingleWindow=YES;
                CGRect frame=target.frame;
                NSString *title=target.title ?: @"";
                [SCScreenshotManager captureImageWithFilter:filter configuration:config completionHandler:^(CGImageRef image,NSError *captureError) {
                    if (!image || captureError) { reply(callback,token,@{@"error":@"macOS could not capture this window. Check Screen Recording permission."}); return; }
                    NSUInteger width=CGImageGetWidth(image),height=CGImageGetHeight(image);
                    NSData *full=jpeg(image,width,height,0.88);
                    double ratio=MIN(1.0,400.0/MAX(width,height));
                    NSData *thumb=jpeg(image,MAX(1,(NSUInteger)(width*ratio)),MAX(1,(NSUInteger)(height*ratio)),0.72);
                    if (!full || !thumb || full.length>8*1024*1024 || thumb.length>256*1024) { reply(callback,token,@{@"error":@"The captured image exceeds JAM's size limit."}); return; }
                    reply(callback,token,@{@"image":[full base64EncodedStringWithOptions:0],@"thumbnail":[thumb base64EncodedStringWithOptions:0],@"width":@(width),@"height":@(height),@"application":application,@"windowTitle":title,@"frame":@[@(frame.origin.x),@(frame.origin.y),@(frame.size.width),@(frame.size.height)]});
                }];
            }];
        } else { reply(callback,token,@{@"error":@"Active window snapshots require macOS 14 or later."}); }
    });
}
void jam_snapshot_feedback(const unsigned char *bytes,size_t length,bool flash,bool sound,bool clipboard,double x,double y,double width,double height) {
    // Called on the main thread only, after runtime persistence succeeds.
    if (clipboard) {
        NSData *data=[NSData dataWithBytes:bytes length:length];
        NSImage *image=[[NSImage alloc] initWithData:data];
        if (image) { [NSPasteboard.generalPasteboard clearContents]; [NSPasteboard.generalPasteboard writeObjects:@[image]]; }
    }
    if (sound) { NSSound *tick=[NSSound soundNamed:@"Tink"]; tick.volume=0.35; [tick play]; }
    if (flash) {
        CGFloat top=NSScreen.screens.firstObject.frame.size.height;
        NSPanel *panel=[[NSPanel alloc] initWithContentRect:NSMakeRect(x,top-y-height,width,height) styleMask:NSWindowStyleMaskBorderless|NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
        panel.releasedWhenClosed=NO; panel.opaque=NO; panel.backgroundColor=[NSColor colorWithWhite:1 alpha:0.18]; panel.ignoresMouseEvents=YES; panel.level=NSStatusWindowLevel; panel.hidesOnDeactivate=NO;
        [panel orderFrontRegardless];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW,120*NSEC_PER_MSEC),dispatch_get_main_queue(),^{ [panel orderOut:nil]; });
    }
}
// Tauri's generic show() makes the window key on macOS. Background capture
// must use ordering only; keyboard focus remains with the captured app.
void jam_snapshot_show_window(void *pointer) {
    NSWindow *window=(__bridge NSWindow *)pointer;
    [window orderFrontRegardless];
}
