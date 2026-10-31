package main

import (
	"context"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"
	"time"
)

func main() {
	debug.SetMemoryLimit(96 * 1024 * 1024)
	server := &http.Server{Addr: ":8081", Handler: newGuard("http://metrics:8428", "http://traces:10428", time.Now), ReadHeaderTimeout: 2 * time.Second, ReadTimeout: 3 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 * 1024, ErrorLog: log.New(io.Discard, "", 0)}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-signals
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		server.Shutdown(ctx)
	}()
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		os.Exit(1)
	}
}
