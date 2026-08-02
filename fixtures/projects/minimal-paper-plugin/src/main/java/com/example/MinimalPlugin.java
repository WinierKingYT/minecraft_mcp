package com.example;

import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.java.JavaPlugin;
import org.jetbrains.annotations.NotNull;

public class MinimalPlugin extends JavaPlugin {

    @Override
    public void onEnable() {
        getLogger().info("MinimalPlugin enabled!");
    }

    @Override
    public void onDisable() {
        getLogger().info("MinimalPlugin disabled!");
    }

    @Override
    public boolean onCommand(@NotNull CommandSender sender, @NotNull Command command,
                             @NotNull String label, @NotNull String[] args) {
        if (command.getName().equalsIgnoreCase("ping")) {
            sender.sendMessage("pong");
            return true;
        }
        return false;
    }
}
