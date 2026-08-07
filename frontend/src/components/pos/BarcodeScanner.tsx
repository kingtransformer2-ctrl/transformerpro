import { useState, useEffect, useRef } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Camera, X } from "lucide-react";

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
}

export function BarcodeScanner({ onScan }: BarcodeScannerProps) {
  const [showCamera, setShowCamera] = useState(false);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);

  useEffect(() => {
    if (showCamera && videoRef.current) {
      startScanning();
    }
    return () => {
      stopScanning();
    };
  }, [showCamera]);

  const startScanning = async () => {
    try {
      setScanning(true);
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      const videoInputDevices = await BrowserMultiFormatReader.listVideoInputDevices();
      if (videoInputDevices.length === 0) {
        throw new Error("No camera found");
      }

      // Use the first available camera (usually back camera on mobile)
      const selectedDeviceId = videoInputDevices[0].deviceId;

      await reader.decodeFromVideoDevice(
        selectedDeviceId,
        videoRef.current!,
        (result, error) => {
          if (result) {
            onScan(result.getText());
            setShowCamera(false);
          }
        }
      );
    } catch (error) {
      console.error("Scanner error:", error);
      setScanning(false);
    }
  };

  const stopScanning = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    readerRef.current = null;
    setScanning(false);
  };

  const handleClose = () => {
    stopScanning();
    setShowCamera(false);
  };

  return (
    <>
      <Button
        onClick={() => setShowCamera(true)}
        variant="outline"
        size="icon"
        title="Scan with camera"
      >
        <Camera className="h-4 w-4" />
      </Button>

      <Dialog open={showCamera} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Scan Barcode</span>
              <Button
                onClick={handleClose}
                variant="ghost"
                size="icon"
                className="h-6 w-6"
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              autoPlay
              playsInline
            />
            {scanning && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="border-2 border-primary w-64 h-32 rounded-lg"></div>
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground text-center">
            Position the barcode within the frame to scan
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
